#!/usr/bin/env node
/**
 * Thin wrapper around walmart-scraper.js used by the Next.js API route via child_process.
 * Writes the scraped products as a JSON array to stdout.
 * All progress/log output is redirected to stderr so stdout stays clean.
 */

const toStderr = (...args) => process.stderr.write(args.join(' ') + '\n');
console.log = toStderr;
console.warn = toStderr;
console.error = toStderr;

const { scrape } = require('./walmart-scraper');

const [, , searchTerm, countryCode = 'US', pageStr = '1'] = process.argv;
const page = Math.max(1, parseInt(pageStr, 10) || 1);

if (!searchTerm) {
  process.stderr.write('Usage: node walmart-query.js <searchTerm> [countryCode] [page]\n');
  process.exit(1);
}

scrape(searchTerm, countryCode, page)
  .then((products) => {
    process.stdout.write(JSON.stringify(products));
    process.exit(0);
  })
  .catch((err) => {
    process.stderr.write('ERROR: ' + err.message + '\n');
    process.exit(1);
  });
