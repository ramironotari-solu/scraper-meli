#!/usr/bin/env node
require('dotenv').config();
const { scrape } = require('./scraper');
const { saveResults, saveResultsCsv, saveResultsXlsx } = require('./utils');
const { COUNTRIES } = require('./config');

// ── CLI argument parsing ───────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultVal;
}

const searchTerm = getArg('--search', null) || args.find((a) => !a.startsWith('--'));
const countryCode = (getArg('--country', 'AR') || 'AR').toUpperCase();
const format = (getArg('--format', 'xlsx') || 'xlsx').toLowerCase();

if (!searchTerm) {
  console.error('❌ Uso: node src/index.js "termino de busqueda" [--country AR] [--format xlsx|csv|json]');
  console.error(`   Países disponibles: ${Object.keys(COUNTRIES).join(', ')}`);
  process.exit(1);
}

// ── Run ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const products = await scrape(searchTerm, countryCode);

    // Print summary table
    console.log('─'.repeat(80));
    console.log(`RESULTADOS: "${searchTerm}" — Mercado Libre ${COUNTRIES[countryCode]?.name}`);
    console.log('─'.repeat(80));

    products.forEach((p, i) => {
      const adTag = p.isAd ? ' [AD]' : '';
      const fullTag = p.hasFull ? ' [FULL]' : '';
      const stars = p.rating ? `★${p.rating}` : '';
      const discount = p.discountPct ? ` -${p.discountPct}%` : '';
      const seller = p.seller ? `  Vendedor: ${p.seller}` : '';

      console.log(`\n${i + 1}.${adTag}${fullTag} ${p.title}`);
      console.log(`   Precio: $${p.price}${discount}${stars ? '  ' + stars : ''}${seller}`);
    });

    console.log('\n' + '─'.repeat(80));

    // Save to file
    let filepath;
    if (format === 'csv') {
      filepath = saveResultsCsv(searchTerm, countryCode, products);
    } else if (format === 'json') {
      filepath = saveResults(searchTerm, countryCode, products);
    } else {
      filepath = saveResultsXlsx(searchTerm, countryCode, products);
    }
    console.log(`\n💾 Guardado en: ${filepath}`);

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
})();
