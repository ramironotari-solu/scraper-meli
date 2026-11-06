#!/usr/bin/env node
/**
 * Thin wrapper around tiendamia-scraper.js for use via child_process.
 * Writes the scraped products as a JSON array to stdout.
 * All progress/log output is redirected to stderr so stdout stays clean.
 */

const toStderr = (...args) => process.stderr.write(args.join(' ') + '\n');
console.log = toStderr;
console.warn = toStderr;
console.error = toStderr;

const { scrape } = require('./tiendamia-scraper');

const [, , searchTerm] = process.argv;

if (!searchTerm) {
  process.stderr.write('Usage: node tiendamia-query.js <searchTerm>\n');
  process.exit(1);
}

scrape(searchTerm)
  .then((products) => {
    process.stdout.write(JSON.stringify(products));
    process.exit(0);
  })
  .catch((err) => {
    process.stderr.write('ERROR: ' + err.message + '\n');
    process.exit(1);
  });
