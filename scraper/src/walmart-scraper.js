const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const rotation = require('./rotation');

puppeteer.use(StealthPlugin());

const MAX_RETRIES = 3;

const WALMART_COUNTRIES = {
  US: { name: 'United States', currency: 'USD', locale: 'en-US', baseUrl: 'https://www.walmart.com' },
  MX: { name: 'México',        currency: 'MXN', locale: 'es-MX', baseUrl: 'https://www.walmart.com.mx' },
};

function buildSearchUrl(country, searchTerm, page = 1) {
  const encoded = encodeURIComponent(searchTerm.trim());
  const base = `${country.baseUrl}/search?q=${encoded}`;
  return page > 1 ? `${base}&page=${page}` : base;
}

// Parse price strings like "$11,099.00" or "11099.0" → number
function parsePriceString(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number') return s > 0 ? s : null;
  const clean = String(s).replace(/[^\d.,]/g, '');
  if (!clean) return null;
  // US/MX format: "11,099.00" — comma is thousands, dot is decimal
  const n = parseFloat(clean.replace(/,/g, ''));
  return isFinite(n) && n > 0 ? n : null;
}

function saveDebugHtml(html) {
  const dest = path.join(__dirname, '..', 'data', 'walmart_debug.html');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html, 'utf8');
  console.log(`   Debug HTML guardado en: ${dest}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── JSON extraction from __NEXT_DATA__ (runs in browser context) ───────────

function extractFromNextData() {
  try {
    const el = document.getElementById('__NEXT_DATA__');
    if (!el) return null;
    const data = JSON.parse(el.textContent);
    const pageProps = data?.props?.pageProps;
    const searchResult =
      pageProps?.initialData?.searchResult ||
      pageProps?.data?.searchResult;
    if (!searchResult) return null;

    const items =
      searchResult?.itemStacks?.[0]?.items ||
      searchResult?.items ||
      [];
    if (!items.length) return null;

    return items.map((item) => {
      // ── Shipping: find the delivery badge (not pickup) ──
      const deliveryBadge = (item.fulfillmentBadgeGroups || []).find(
        (g) => g.key === 'FF_DELIVERY' || g.key === 'FF_SHIPPING'
      );
      const shippingText = deliveryBadge
        ? ((deliveryBadge.text || '') + (deliveryBadge.slaText || '')).trim()
        : null;

      const shippingLower = (shippingText || '').toLowerCase();
      // Free when shipPrice is empty/zero
      const hasFreeShipping =
        item.priceInfo?.shipPrice === '' ||
        item.priceInfo?.shipPrice === '0' ||
        item.priceInfo?.shipPrice === 0 ||
        shippingLower.includes('free') ||
        shippingLower.includes('sin costo');
      // Fast when same-day or next-day
      const hasFull =
        shippingLower.includes('hoy') ||
        shippingLower.includes('mañana') ||
        shippingLower.includes('today') ||
        shippingLower.includes('tomorrow');

      return {
        titleText:        item.name || null,
        canonicalUrl:     item.canonicalUrl || null,
        // item.price is the numeric current price (direct field)
        price:            (typeof item.price === 'number' && item.price > 0) ? item.price : null,
        // original/was price is a formatted string in priceInfo
        originalPriceStr: item.priceInfo?.itemPrice || item.priceInfo?.wasPrice || null,
        savingsAmt:       item.priceInfo?.savingsAmt ?? null,
        rating:           item.averageRating ?? null,
        reviewCount:      item.numberOfReviews ?? null,
        seller:           item.sellerName || item.sellerInfo?.sellerDisplayName || null,
        shippingText,
        hasFreeShipping,
        hasFull,
        isAd:             !!(item.isSponsoredFlag || item.sponsoredProduct),
        thumbnail:        item.imageInfo?.thumbnailUrl || null,
      };
    });
  } catch {
    return null;
  }
}

// ── DOM fallback extraction (runs in browser context) ─────────────────────

function extractFromDOM() {
  const cards = Array.from(document.querySelectorAll('[data-item-id]'));
  if (!cards.length) return null;

  return cards.map((card) => {
    const titleLink =
      card.querySelector('a[link-identifier]') ||
      card.querySelector('a[href*="/ip/"]') ||
      card.querySelector('a');
    const titleSpan =
      card.querySelector('[data-automation-id="product-title"]') ||
      card.querySelector('span.lh-title') ||
      card.querySelector('span.f6');
    const titleText = ((titleSpan || titleLink)?.textContent || '').trim() || null;
    const canonicalUrl = titleLink?.href || null;

    // Price: try itemprop first, then text content of price elements
    const priceEl =
      card.querySelector('[itemprop="price"]') ||
      card.querySelector('[data-automation-id="product-price"]') ||
      card.querySelector('[class*="price-main"]');
    const priceContent =
      priceEl?.getAttribute('content') ||
      priceEl?.getAttribute('data-price') ||
      priceEl?.textContent || null;
    const price = priceContent
      ? parseFloat(priceContent.replace(/[^\d.]/g, '')) || null
      : null;

    // Was price (strikethrough)
    const wasEl =
      card.querySelector('[data-automation-id="was-price"]') ||
      card.querySelector('s span') ||
      card.querySelector('.strike');
    const originalPriceStr = wasEl?.textContent?.trim() || null;

    // Rating
    const ratingEl =
      card.querySelector('[data-automation-id="product-ratings"]') ||
      card.querySelector('[itemprop="ratingValue"]');
    const ratingVal =
      ratingEl?.getAttribute('data-value') ||
      ratingEl?.getAttribute('content') ||
      ratingEl?.textContent || '';
    const rating = parseFloat(ratingVal) || null;

    // Reviews
    const reviewEl =
      card.querySelector('[data-automation-id="product-review-count"]') ||
      card.querySelector('[itemprop="reviewCount"]');
    const reviewCount = reviewEl
      ? parseInt(reviewEl.textContent.replace(/\D/g, ''), 10) || null
      : null;

    // Shipping text
    const shippingEl =
      card.querySelector('[data-automation-id="fulfillment-badge"]') ||
      card.querySelector('[class*="fulfillment"]') ||
      card.querySelector('[class*="delivery"]') ||
      card.querySelector('[class*="shipping"]');
    const shippingText = shippingEl?.textContent?.trim() || null;
    const shippingLower = (shippingText || '').toLowerCase();
    const hasFreeShipping = shippingLower.includes('free') || shippingLower.includes('sin costo') || shippingLower.includes('gratis');
    const hasFull = shippingLower.includes('hoy') || shippingLower.includes('mañana') ||
                    shippingLower.includes('today') || shippingLower.includes('tomorrow');

    const sellerEl = card.querySelector('[data-automation-id="sold-by"]');
    const seller = (sellerEl?.textContent || '')
      .replace(/^(Sold by|Vendido por)\s*/i, '').trim() || null;

    const isAd =
      !!card.querySelector('[data-automation-id="sponsored-badge"]') ||
      (card.textContent || '').toLowerCase().includes('sponsored');

    const imgEl = card.querySelector('img');
    const thumbnail = imgEl?.src || imgEl?.getAttribute('data-src') || null;

    return {
      titleText, canonicalUrl, price, originalPriceStr: originalPriceStr,
      savingsAmt: null, rating, reviewCount,
      seller, shippingText, hasFreeShipping, hasFull, isAd, thumbnail,
    };
  });
}

// ── Single attempt ─────────────────────────────────────────────────────────

async function attempt(url, baseUrl, locale, attemptNum) {
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

    if (proxy) {
      const parsed = rotation.parseProxy(proxy);
      if (parsed.username) {
        await page.authenticate({ username: parsed.username, password: parsed.password });
      }
    }

    await page.setViewport(profile.viewport);
    await page.setUserAgent(profile.userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': lang });
    await sleep(500 + Math.random() * 1000);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });

    const pageTitle   = await page.title();
    const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');
    const isBlocked   =
      pageTitle.toLowerCase().includes('robot')             ||
      bodySnippet.toLowerCase().includes('captcha')         ||
      bodySnippet.toLowerCase().includes('verify you are')  ||
      bodySnippet.toLowerCase().includes('access denied');
    if (isBlocked) throw new Error('BLOCKED');

    // Try JSON extraction first — doesn't need product DOM to be ready
    let raw = await page.evaluate(extractFromNextData);

    if (!raw || raw.length === 0) {
      try {
        await page.waitForSelector('[data-item-id]', { timeout: 15000 });
      } catch {
        const content = await page.content();
        const lc = bodySnippet.toLowerCase();
        if (lc.includes('no results') || lc.includes('no se encontraron') || lc.includes('no encontramos')) {
          return [];
        }
        saveDebugHtml(content);
        throw new Error('NO_RESULTS');
      }
      raw = await page.evaluate(extractFromDOM);
    }

    // Resolve relative canonical URLs to absolute
    return (raw || []).map((item) => ({
      ...item,
      url: item.canonicalUrl
        ? (item.canonicalUrl.startsWith('http') ? item.canonicalUrl : `${baseUrl}${item.canonicalUrl}`)
        : null,
    }));

  } finally {
    await browser.close();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function scrape(searchTerm, countryCode = 'US', page = 1) {
  const country = WALMART_COUNTRIES[countryCode];
  if (!country) {
    throw new Error(
      `Código de país inválido para Walmart: ${countryCode}. Disponibles: ${Object.keys(WALMART_COUNTRIES).join(', ')}`
    );
  }

  const url = buildSearchUrl(country, searchTerm, page);
  console.log(`\n🔍 Buscando "${searchTerm}" en Walmart ${country.name}...`);
  console.log(`   URL: ${url}`);

  if (rotation.hasProxies()) {
    console.log(`   Proxies disponibles: ${rotation.proxyCount()}`);
  } else {
    console.log(`   Sin proxies configurados (usando IP directa)`);
  }

  let lastError;

  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      const raw = await attempt(url, country.baseUrl, country.locale, i);

      const products = raw.map((p) => {
        const price         = p.price;  // already a number from item.price
        const originalPrice = parsePriceString(p.originalPriceStr);

        // Prefer savingsAmt for discount % — more accurate than computing from prices
        let discountPct = null;
        if (p.savingsAmt != null && originalPrice && originalPrice > 0) {
          discountPct = Math.round((p.savingsAmt / originalPrice) * 100);
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
          shippingText:    p.shippingText,
        };
      });

      console.log(`✅ ${products.length} productos obtenidos.`);
      console.log(`   - ${products.filter((p) => p.isAd).length} son anuncios`);
      console.log(`   - ${products.filter((p) => p.hasFull).length} con entrega hoy/mañana\n`);

      return products;

    } catch (err) {
      lastError = err;
      const reason =
        err.message === 'BLOCKED'    ? 'bloqueado por Walmart' :
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
