const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const rotation = require('./rotation');

puppeteer.use(StealthPlugin());

const MAX_RETRIES = 3;

const BASE_URL = 'https://tiendamia.com.ar';

function buildSearchUrl(searchTerm) {
  const slug = searchTerm.trim().replace(/\s+/g, '+');
  return `${BASE_URL}/search/amazon/${slug}`;
}

// Prices are formatted as "AR$298.393" — dot is thousands separator, no decimals
function parseArsPrice(str) {
  if (!str) return null;
  const clean = str.replace(/[^0-9]/g, '');
  const n = parseInt(clean, 10);
  return isFinite(n) && n > 0 ? n : null;
}

function saveDebugHtml(html) {
  const dest = path.join(__dirname, '..', 'data', 'tiendamia_debug.html');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html, 'utf8');
  console.log(`   Debug HTML guardado en: ${dest}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Runs inside browser context — extracts all product cards
function extractProducts() {
  const cards = document.querySelectorAll('div.item-card');

  return Array.from(cards).map((card) => {
    // ── Link ──
    const linkEl = card.querySelector('a.item-link');
    const url = linkEl?.href || null;

    // ── Image ──
    const imgEl = card.querySelector('img.item-image');
    const thumbnail = imgEl?.src || null;

    // ── Brand & Title ──
    const brand = card.querySelector('p.item-brand')?.textContent?.trim() || null;
    const title = card.querySelector('h2.item-title')?.textContent?.trim() || null;

    // ── Prices (ARS, dot = thousands separator) ──
    const priceMainRaw    = card.querySelector('div.item-price-main')?.textContent?.trim() || null;
    const priceCrossedRaw = card.querySelector('span.item-price-crossed')?.textContent?.trim() || null;

    // ── Discount ──
    const discountRaw = card.querySelector('div.item-price-percentage')?.textContent?.trim() || null;

    // ── Ad / sponsored ──
    const isAd = card.classList.contains('promoted');

    // ── Condition: inferred from title keywords ──
    const titleLower = (title || '').toLowerCase();
    const isUsed =
      titleLower.includes('renewed')     ||
      titleLower.includes('refurbished') ||
      titleLower.includes('renovado')    ||
      titleLower.includes('reacondicionado') ||
      titleLower.includes('usado')       ||
      titleLower.includes('used');

    return { url, thumbnail, brand, title, priceMainRaw, priceCrossedRaw, discountRaw, isAd, isUsed };
  });
}

async function attempt(url, attemptNum) {
  const proxy   = rotation.nextProxy();
  const profile = rotation.nextProfile();

  const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
  if (proxy) {
    const { server } = rotation.parseProxy(proxy);
    launchArgs.push(`--proxy-server=${server}`);
    console.log(`   [intento ${attemptNum}] proxy: ${server} | UA: ${profile.userAgent.slice(0, 40)}...`);
  } else {
    console.log(`   [intento ${attemptNum}] sin proxy | UA: ${profile.userAgent.slice(0, 40)}...`);
  }

  const browser = await puppeteer.launch({ headless: true, args: launchArgs });

  try {
    const page = await browser.newPage();

    if (proxy) {
      const parsed = rotation.parseProxy(proxy);
      if (parsed.username) {
        await page.authenticate({ username: parsed.username, password: parsed.password });
      }
    }

    await page.setViewport(profile.viewport);
    await page.setUserAgent(profile.userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-AR,es;q=0.9' });

    await sleep(500 + Math.random() * 1000);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });

    const pageTitle   = await page.title();
    const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');

    const isBlocked =
      pageTitle.toLowerCase().includes('robot')          ||
      pageTitle.toLowerCase().includes('challenge')      ||
      bodySnippet.toLowerCase().includes('captcha')      ||
      bodySnippet.toLowerCase().includes('access denied');
    if (isBlocked) throw new Error('BLOCKED');

    // Wait for product cards
    try {
      await page.waitForSelector('div.item-card', { timeout: 15000 });
    } catch {
      const content = await page.content();
      if (bodySnippet.toLowerCase().includes('no encontramos') ||
          bodySnippet.toLowerCase().includes('no results')) {
        return [];
      }
      saveDebugHtml(content);
      throw new Error('NO_RESULTS');
    }

    return await page.evaluate(extractProducts);

  } finally {
    await browser.close();
  }
}

async function scrape(searchTerm) {
  const url = buildSearchUrl(searchTerm);
  console.log(`\n🔍 Buscando "${searchTerm}" en Tiendamia...`);
  console.log(`   URL: ${url}`);

  if (rotation.hasProxies()) {
    console.log(`   Proxies disponibles: ${rotation.proxyCount()}`);
  } else {
    console.log(`   Sin proxies configurados (usando IP directa)`);
  }

  let lastError;

  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      const raw = await attempt(url, i);

      const products = raw.map((p) => {
        const price         = parseArsPrice(p.priceMainRaw);
        const originalPrice = parseArsPrice(p.priceCrossedRaw);

        let discountPct = null;
        if (p.discountRaw) {
          const m = p.discountRaw.match(/(\d+)/);
          if (m) discountPct = parseInt(m[1], 10);
        } else if (originalPrice && price && originalPrice > price) {
          discountPct = Math.round(((originalPrice - price) / originalPrice) * 100);
        }

        return {
          title:           p.title,
          brand:           p.brand,
          url:             p.url,
          price,
          originalPrice,
          discountPct,
          rating:          null,
          reviewCount:     null,
          seller:          'Amazon via Tiendamia',
          hasFull:         false,
          hasFreeShipping: false,
          isAd:            p.isAd,
          thumbnail:       p.thumbnail,
          isInternational: false,
          isUsed:          p.isUsed,
        };
      });

      console.log(`✅ ${products.length} productos obtenidos.`);
      console.log(`   - ${products.filter((p) => p.isAd).length} son anuncios`);
      console.log(`   - ${products.filter((p) => p.isUsed).length} reacondicionados/usados\n`);

      return products;

    } catch (err) {
      lastError = err;
      const reason =
        err.message === 'BLOCKED'    ? 'bloqueado por Tiendamia' :
        err.message === 'NO_RESULTS' ? 'sin resultados / selector no encontrado' :
        err.message;

      console.warn(`   ⚠️  Intento ${i} fallido: ${reason}`);

      if (i < MAX_RETRIES) {
        const wait = 2000 * i;
        console.log(`   Reintentando en ${wait / 1000}s con otro perfil...`);
        await sleep(wait);
      }
    }
  }

  throw new Error(`Falló después de ${MAX_RETRIES} intentos. Último error: ${lastError?.message}`);
}

module.exports = { scrape };
