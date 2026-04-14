const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

/**
 * Runs async tasks with a concurrency limit.
 * @param {Array} items
 * @param {number} limit
 * @param {Function} fn
 */
async function pLimit(items, limit, fn) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

const COLUMNS = [
  { key: 'title',          header: 'Título' },
  { key: 'price',          header: 'Precio' },
  { key: 'discountPct',    header: 'Descuento %' },
  { key: 'rating',         header: 'Calificación' },
  { key: 'reviewCount',    header: 'Reseñas' },
  { key: 'seller',         header: 'Vendedor' },
  { key: 'hasFull',        header: 'Envío FULL' },
  { key: 'hasFreeShipping',header: 'Envío Gratis' },
  { key: 'isAd',           header: 'Publicidad' },
  { key: 'url',            header: 'URL' },
];

function buildSlug(searchTerm, country) {
  return `${country}_${searchTerm.replace(/\s+/g, '_')}_${Date.now()}`;
}

function ensureDataDir() {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

function saveResults(searchTerm, country, products) {
  const dataDir = ensureDataDir();
  const filepath = path.join(dataDir, `${buildSlug(searchTerm, country)}.json`);

  fs.writeFileSync(filepath, JSON.stringify({
    searchTerm,
    country,
    scrapedAt: new Date().toISOString(),
    total: products.length,
    products,
  }, null, 2), 'utf8');

  return filepath;
}

function saveResultsCsv(searchTerm, country, products) {
  const dataDir = ensureDataDir();
  const filepath = path.join(dataDir, `${buildSlug(searchTerm, country)}.csv`);

  const header = COLUMNS.map((c) => c.header).join(',');
  const rows = products.map((p) =>
    COLUMNS.map(({ key }) => {
      const val = p[key] ?? '';
      const str = String(val);
      // Quote fields that contain commas, quotes, or newlines
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(',')
  );

  fs.writeFileSync(filepath, [header, ...rows].join('\n'), 'utf8');
  return filepath;
}

function saveResultsXlsx(searchTerm, country, products) {
  const dataDir = ensureDataDir();
  const filepath = path.join(dataDir, `${buildSlug(searchTerm, country)}.xlsx`);

  const sheetData = [
    COLUMNS.map((c) => c.header),
    ...products.map((p) => COLUMNS.map(({ key }) => p[key] ?? '')),
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Auto column widths (rough estimate)
  ws['!cols'] = COLUMNS.map(({ header }) => ({ wch: Math.max(header.length + 2, 18) }));

  XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
  XLSX.writeFile(wb, filepath);
  return filepath;
}

module.exports = { pLimit, saveResults, saveResultsCsv, saveResultsXlsx };
