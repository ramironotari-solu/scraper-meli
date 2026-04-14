/**
 * Proxy & User-Agent rotation utilities.
 *
 * Proxies can be configured in two ways (in order of precedence):
 *   1. MELI_PROXIES env var — comma-separated list of proxy URLs
 *   2. scraper/proxies.txt  — one proxy per line
 *
 * Proxy URL format:
 *   http://host:port
 *   http://user:pass@host:port
 *   socks5://host:port
 *
 * If no proxies are configured the scraper runs without proxy (direct IP).
 */

const fs   = require('fs');
const path = require('path');

// ── Proxy pool ─────────────────────────────────────────────────────────────

function loadProxies() {
  // 1. Env var
  if (process.env.MELI_PROXIES) {
    return process.env.MELI_PROXIES
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }

  // 2. proxies.txt next to this file's parent dir (scraper/proxies.txt)
  const txtPath = path.join(__dirname, '..', 'proxies.txt');
  if (fs.existsSync(txtPath)) {
    return fs
      .readFileSync(txtPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }

  return [];
}

const _proxies = loadProxies();
let _proxyIndex = 0;

/**
 * Returns the next proxy URL in round-robin order, or null if none configured.
 */
function nextProxy() {
  if (_proxies.length === 0) return null;
  const proxy = _proxies[_proxyIndex % _proxies.length];
  _proxyIndex++;
  return proxy;
}

/**
 * Parses a proxy URL into the parts Puppeteer needs.
 *   { server: 'http://host:port', username?, password? }
 */
function parseProxy(proxyUrl) {
  const u = new URL(proxyUrl);
  const server = `${u.protocol}//${u.hostname}:${u.port}`;
  return {
    server,
    username: u.username || undefined,
    password: u.password || undefined,
  };
}

// ── User-Agent / viewport pool ─────────────────────────────────────────────

const UA_POOL = [
  // Chrome 124 — Windows
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport:  { width: 1920, height: 1080 },
  },
  // Chrome 124 — Windows (laptop res)
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport:  { width: 1366, height: 768 },
  },
  // Chrome 123 — macOS
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    viewport:  { width: 1440, height: 900 },
  },
  // Chrome 122 — macOS (Retina)
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport:  { width: 2560, height: 1600 },
  },
  // Firefox 125 — Windows
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    viewport:  { width: 1920, height: 1080 },
  },
  // Firefox 124 — Linux
  {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
    viewport:  { width: 1280, height: 800 },
  },
  // Safari 17 — macOS
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    viewport:  { width: 1440, height: 900 },
  },
  // Edge 124 — Windows
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
    viewport:  { width: 1536, height: 864 },
  },
];

let _uaIndex = 0;

/**
 * Returns the next { userAgent, viewport } profile in round-robin order.
 */
function nextProfile() {
  const profile = UA_POOL[_uaIndex % UA_POOL.length];
  _uaIndex++;
  return profile;
}

// ── Accept-Language variants ───────────────────────────────────────────────

const ACCEPT_LANGUAGE = {
  'es-AR': ['es-AR,es;q=0.9,en;q=0.8', 'es-AR,es-419;q=0.9,es;q=0.8', 'es-AR,es;q=0.9'],
  'es-MX': ['es-MX,es;q=0.9,en;q=0.8', 'es-MX,es-419;q=0.9,es;q=0.8'],
  'pt-BR': ['pt-BR,pt;q=0.9,en;q=0.8', 'pt-BR,pt;q=0.9'],
  'es-CO': ['es-CO,es;q=0.9,en;q=0.8', 'es-CO,es-419;q=0.9,es;q=0.8'],
  'es-CL': ['es-CL,es;q=0.9,en;q=0.8', 'es-CL,es-419;q=0.9,es;q=0.8'],
  'es-UY': ['es-UY,es;q=0.9,en;q=0.8', 'es-UY,es-419;q=0.9,es;q=0.8'],
};

function pickAcceptLanguage(locale) {
  const variants = ACCEPT_LANGUAGE[locale] || [`${locale},es;q=0.9`];
  return variants[Math.floor(Math.random() * variants.length)];
}

// ── Public API ─────────────────────────────────────────────────────────────

module.exports = {
  hasProxies:        () => _proxies.length > 0,
  proxyCount:        () => _proxies.length,
  nextProxy,
  parseProxy,
  nextProfile,
  pickAcceptLanguage,
};
