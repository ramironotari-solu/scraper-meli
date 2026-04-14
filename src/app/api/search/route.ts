import { spawn } from 'child_process';
import path from 'path';
import type { Product, MarketStats } from '@/lib/types';

export const maxDuration = 120;

const VALID_COUNTRIES = new Set(['AR', 'MX', 'BR', 'CO', 'CL', 'UY']);

export async function POST(request: Request) {
  let body: { query?: unknown; country?: unknown; page?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Cuerpo de solicitud inválido' }, { status: 400 });
  }

  const query = String(body.query ?? '').trim();
  const country = String(body.country ?? 'AR').toUpperCase();
  const page = Math.max(1, Number(body.page ?? 1));

  if (!query) {
    return Response.json({ error: 'Se requiere un término de búsqueda' }, { status: 400 });
  }
  if (!VALID_COUNTRIES.has(country)) {
    return Response.json({ error: 'Código de país inválido' }, { status: 400 });
  }

  const scriptPath = path.join(process.cwd(), 'scraper', 'src', 'query.js');

  try {
    const products = await runScraper(scriptPath, query, country, page);
    // Only compute stats on first page — they anchor the MarketSummary card
    const stats = page === 1 ? computeStats(products) : undefined;
    return Response.json({ products, page, hasMore: products.length === 50, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error en el scraper';
    return Response.json({ error: message }, { status: 500 });
  }
}

function computeStats(products: Product[]): MarketStats {
  const prices = products.filter(p => p.price != null).map(p => p.price!);
  const withDiscount = products.filter(p => p.discountPct != null && p.discountPct > 0);

  const sellerFreq: Record<string, number> = {};
  products.forEach(p => {
    if (p.seller) sellerFreq[p.seller] = (sellerFreq[p.seller] ?? 0) + 1;
  });
  const topSellers = Object.entries(sellerFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  const ratings = products.filter(p => p.rating != null).map(p => p.rating!);

  return {
    total: products.length,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    avgPrice: prices.length
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : null,
    discountCount: withDiscount.length,
    avgDiscount: withDiscount.length
      ? Math.round(withDiscount.reduce((s, p) => s + p.discountPct!, 0) / withDiscount.length)
      : 0,
    topSellers,
    freeShippingCount: products.filter(p => p.hasFreeShipping).length,
    fullCount: products.filter(p => p.hasFull).length,
    adCount: products.filter(p => p.isAd).length,
    avgRating: ratings.length
      ? parseFloat((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1))
      : null,
  };
}

function runScraper(
  scriptPath: string,
  query: string,
  country: string,
  page: number,
): Promise<Product[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, query, country, String(page)]);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(stderr.slice(-500) || `Proceso terminó con código ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Product[]);
      } catch {
        reject(new Error('No se pudo parsear la respuesta del scraper'));
      }
    });

    child.on('error', reject);
  });
}
