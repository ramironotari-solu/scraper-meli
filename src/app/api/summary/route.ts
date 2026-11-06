import Anthropic from '@anthropic-ai/sdk';
import type { MarketStats } from '@/lib/types';

const COUNTRY_NAMES: Record<string, string> = {
  AR: 'Argentina', MX: 'México', BR: 'Brasil',
  CO: 'Colombia', CL: 'Chile', UY: 'Uruguay',
  US: 'United States',
};

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ summary: null });
  }

  let body: { query: string; country: string; stats: MarketStats; marketplace?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ summary: null });
  }

  const { query, country, stats, marketplace = 'meli' } = body;
  const countryName = COUNTRY_NAMES[country] ?? country;
  const marketplaceName = marketplace === 'walmart' ? 'Walmart' : 'Mercado Libre';
  const freeShippingPct = Math.round((stats.freeShippingCount / stats.total) * 100);
  const discountPct = Math.round((stats.discountCount / stats.total) * 100);

  const prompt = `Sos un analista de mercado especializado en e-commerce. Analizá estos resultados de ${marketplaceName} como si asesoraras a un vendedor que quiere entender la competencia y definir su precio de entrada. Escribí 2-3 oraciones en español, directo al punto.

Búsqueda: "${query}" en ${countryName} (${marketplaceName})
- ${stats.total} productos encontrados
- Precio promedio: $${stats.avgPrice?.toLocaleString('es-AR') ?? '—'} | Rango: $${stats.minPrice?.toLocaleString('es-AR') ?? '—'} – $${stats.maxPrice?.toLocaleString('es-AR') ?? '—'}
- ${stats.discountCount} de ${stats.total} productos con descuento (${discountPct}%), descuento promedio: ${stats.avgDiscount}%
- Envío gratis en ${freeShippingPct}% de los productos
- Principales vendedores: ${stats.topSellers.join(', ')}
${stats.avgRating != null ? `- Calificación promedio: ${stats.avgRating} estrellas` : ''}

Escribí solo el párrafo de análisis, sin introducción, sin cierre, sin formato markdown.`;

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    const summary = message.content[0].type === 'text' ? message.content[0].text : null;
    return Response.json({ summary });
  } catch {
    return Response.json({ summary: null });
  }
}
