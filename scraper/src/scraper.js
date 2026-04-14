const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { COUNTRIES } = require('./config');
const rotation = require('./rotation');

puppeteer.use(StealthPlugin());

const MAX_RETRIES = 3;

// ── Helpers ────────────────────────────────────────────────────────────────

function buildSearchUrl(country, searchTerm, page = 1) {
  const slug = searchTerm.trim().replace(/\s+/g, '-').toLowerCase();
  const base = `${country.baseUrl}/${slug}`;
  if (page <= 1) return base;
  const offset = (page - 1) * 50 + 1;
  return `${base}_Desde_${offset}_NoIndex_True`;
}

// MeLi uses dots as thousands separators: "1.299.999" → 1299999
function parsePrice(str) {
  if (!str) return null;
  return parseFloat(str.replace(/\./g, '').replace(',', '.')) || null;
}

function saveDebugHtml(html) {
  const dest = path.join(__dirname, '..', 'data', 'meli_debug.html');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html, 'utf8');
  console.log(`   Debug HTML guardado en: ${dest}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Page extraction (runs inside browser context) ─────────────────────────

function extractProducts() {
  const items = document.querySelectorAll('.ui-search-layout__item');

  return Array.from(items).map((item) => {
    // ── Title & URL ──
    const titleLink =
      item.querySelector('a.poly-component__title') ||
      item.querySelector('a.ui-search-link');
    const titleText =
      titleLink?.querySelector('h2,h3')?.textContent?.trim() ||
      titleLink?.textContent?.trim() ||
      null;
    const url = titleLink?.href || null;

    // ── Current price ──
    const currentPriceContainer =
      item.querySelector('.poly-price__current') ||
      item.querySelector('.ui-search-price__part--medium');
    const fractionEl = currentPriceContainer?.querySelector('.andes-money-amount__fraction');
    const centsEl    = currentPriceContainer?.querySelector('.andes-money-amount__cents');
    const priceRaw   = fractionEl?.textContent?.trim() || null;
    const priceCents = centsEl?.textContent?.trim() || null;

    // ── Original price (struck-through) ──
    const originalEl = item.querySelector(
      's.andes-money-amount--previous .andes-money-amount__fraction,' +
      '.andes-money-amount--previous .andes-money-amount__fraction'
    );
    const originalPriceRaw = originalEl?.textContent?.trim() || null;

    // ── Discount label ──
    const discountEl =
      item.querySelector('.andes-money-amount__discount') ||
      item.querySelector('.poly-price__discount')         ||
      item.querySelector('.ui-search-price__discount');
    const discountText = discountEl?.textContent?.trim() || null;

    // ── Rating ──
    const ratingEl =
      item.querySelector('.poly-reviews__rating') ||
      item.querySelector('.ui-search-reviews__rating-number');
    const rating = ratingEl ? parseFloat(ratingEl.textContent.trim()) : null;

    // ── Review count ──
    const reviewEl =
      item.querySelector('.poly-reviews__total') ||
      item.querySelector('.ui-search-reviews__amount');
    const reviewText = reviewEl?.textContent?.replace(/[()]/g, '').trim() || null;
    const reviewCount = reviewText ? parseInt(reviewText, 10) : null;

    // ── Shipping ──
    const shippingEl =
      item.querySelector('.poly-component__shipping') ||
      item.querySelector('.ui-search-item__shipping');
    const shippingText = shippingEl?.textContent?.trim()?.toLowerCase() || '';
    const hasFreeShipping = shippingText.includes('gratis') || shippingText.includes('free');
    const hasFull =
      shippingText.includes('full') ||
      !!item.querySelector('.poly-shipping__tags--full') ||
      !!item.querySelector('[class*="fulfillment"]');

    // ── Seller ──
    const sellerEl =
      item.querySelector('.poly-component__seller')               ||
      item.querySelector('.ui-search-official-store-item__label') ||
      item.querySelector('.ui-search-item__brand-discoverability-label');
    const seller = sellerEl?.textContent?.trim() || null;

    // ── Ad / sponsored ──
    const adEl =
      item.querySelector('.poly-component__highlight')   ||
      item.querySelector('[class*="promoted"]')          ||
      item.querySelector('[class*="sponsored"]')         ||
      item.querySelector('.ui-search-item__promoted-label');
    const isAd = !!adEl;

    // ── Thumbnail ──
    const imgEl =
      item.querySelector('img.poly-component__picture')            ||
      item.querySelector('img.ui-search-result-image__element')    ||
      item.querySelector('img');
    const thumbnail =
      imgEl?.src ||
      imgEl?.getAttribute('data-src') ||
      null;

    return {
      titleText, url,
      priceRaw, priceCents, originalPriceRaw, discountText,
      rating, reviewCount,
      hasFull, hasFreeShipping,
      seller, isAd, thumbnail,
    };
  });
}

// ── Single attempt ─────────────────────────────────────────────────────────

async function attempt(url, locale, attemptNum) {
  const proxy   = rotation.nextProxy();
  const profile = rotation.nextProfile();
  const lang    = rotation.pickAcceptLanguage(locale);

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

    // Proxy auth if needed
    if (proxy) {
      const parsed = rotation.parseProxy(proxy);
      if (parsed.username) {
        await page.authenticate({ username: parsed.username, password: parsed.password });
      }
    }

    await page.setViewport(profile.viewport);
    await page.setUserAgent(profile.userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': lang });

    // Small random delay to look more human (500–1500 ms)
    await sleep(500 + Math.random() * 1000);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });

    // Detect bot-block / verification page (check title AND body)
    const pageTitle   = await page.title();
    const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');
    const isBlocked   =
      pageTitle.toLowerCase().includes('verificacion')  ||
      pageTitle.toLowerCase().includes('verification')  ||
      pageTitle.toLowerCase().includes('suspicious')    ||
      bodySnippet.toLowerCase().includes('suspicious')  ||
      bodySnippet.toLowerCase().includes('verificacion')||
      bodySnippet.toLowerCase().includes('robot')       ||
      bodySnippet.toLowerCase().includes('captcha');
    if (isBlocked) {
      throw new Error('BLOCKED');
    }

    // Wait for at least one product card
    try {
      await page.waitForSelector('.ui-search-layout__item', { timeout: 15000 });
    } catch {
      const content = await page.content();
      // If there are truly no results (valid empty search), don't retry
      if (content.includes('ui-search-rescue') || content.includes('no-results')) {
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

// ── Main ──────────────────────────────────────────────────────────────────

async function scrape(searchTerm, countryCode = 'AR', page = 1) {
  const country = COUNTRIES[countryCode];
  if (!country) {
    throw new Error(
      `Código de país desconocido: ${countryCode}. Disponibles: ${Object.keys(COUNTRIES).join(', ')}`
    );
  }

  const url = buildSearchUrl(country, searchTerm, page);
  console.log(`\n🔍 Buscando "${searchTerm}" en Mercado Libre ${country.name}...`);
  console.log(`   URL: ${url}`);

  if (rotation.hasProxies()) {
    console.log(`   Proxies disponibles: ${rotation.proxyCount()}`);
  } else {
    console.log(`   Sin proxies configurados (usando IP directa)`);
  }

  let lastError;

  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      const raw = await attempt(url, country.locale, i);

      // ── Post-process: parse prices, compute discount ──
      const products = raw.map((p) => {
        const price         = parsePrice(p.priceRaw);
        const originalPrice = parsePrice(p.originalPriceRaw);

        let discountPct = null;
        if (p.discountText) {
          const m = p.discountText.match(/(\d+)\s*%/);
          if (m) discountPct = parseInt(m[1], 10);
        } else if (originalPrice && price && originalPrice > price) {
          discountPct = Math.round(((originalPrice - price) / originalPrice) * 100);
        }

        return {
          title:           p.titleText,
          url:             p.url,
          price,
          originalPrice,
          discountPct,
          rating:          p.rating,
          reviewCount:     p.reviewCount,
          seller:          p.seller,
          hasFull:         p.hasFull,
          hasFreeShipping: p.hasFreeShipping,
          isAd:            p.isAd,
          thumbnail:       p.thumbnail,
        };
      });

      console.log(`✅ ${products.length} productos obtenidos.`);
      console.log(`   - ${products.filter((p) => p.isAd).length} son anuncios`);
      console.log(`   - ${products.filter((p) => p.hasFull).length} tienen envío FULL\n`);

      return products;

    } catch (err) {
      lastError = err;
      const reason = err.message === 'BLOCKED'    ? 'bloqueado por MeLi' :
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
