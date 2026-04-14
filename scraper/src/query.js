#!/usr/bin/env node
/**
 * Thin wrapper around scraper.js used by the Next.js API route via child_process.
 * Writes the scraped products as a JSON array to stdout.
 * All progress/log output is redirected to stderr so stdout stays clean.
 */

// Redirect all console output to stderr before requiring the scraper
const toStderr = (...args) => process.stderr.write(args.join(' ') + '\n');
console.log = toStderr;
console.warn = toStderr;
console.error = toStderr;

const { scrape } = require('./scraper');

const [, , searchTerm, countryCode = 'AR', pageStr = '1'] = process.argv;
const page = Math.max(1, parseInt(pageStr, 10) || 1);

if (!searchTerm) {
  process.stderr.write('Usage: node query.js <searchTerm> [countryCode] [page]\n');
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
