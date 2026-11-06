#!/usr/bin/env node
/**
 * Reads chiq_tv_forecast.xlsx, searches TCL competitors on MeLi Mexico
 * for each product row, and writes results to the "Resultados" sheet.
 *
 * Usage: node scraper/src/tcl-research.js
 */

require('dotenv').config();
const path    = require('path');
const ExcelJS = require('exceljs');
const { scrape } = require('./scraper');

const FILE         = path.join(__dirname, '..', 'data', 'chiq_tv_forecast.xlsx');
const SOURCE_SHEET = 'TV Pricing + FCST';
const TARGET_SHEET = 'Resultados';
const DELAY_MS     = 8000;
const COUNTRY      = 'MX';

// Col indices (0-based): C=2 D=3 E=4 F=5 G=6 H=7 I=8 J=9 K=10 L=11
const C_CONCEPTO = 2, C_BRAND = 3, C_MODEL = 4, C_INCH = 5,
      C_TECH = 6, C_SMART = 7, C_RRP = 8, C_IVA = 9, C_DM = 10, C_GOSSINV = 11;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cellVal(ws, r, c) {
  return ws.getRow(r + 1).getCell(c + 1).value ?? '';
}

function extractInchNum(inchStr) {
  const m = String(inchStr).match(/(\d+)/);
  return m ? m[1] : null;
}

const TECH_ALIASES = {
  uhd: ['uhd', '4k', 'ultra hd', 'ultra-hd'],
};

// Returns true if inchNum appears in title as a TV size (not as hz, mp, fps, etc.)
function inchInTitle(title, inchNum) {
  const t = title.toLowerCase();
  const re = new RegExp('(?<!\\d)' + inchNum + '(?!\\d)', 'g');
  const NON_TV = /^(hz|mhz|fps|mp|megap|gb|tb|mb|w\b|rpm|km|kg|mm|cm)/;
  let m;
  while ((m = re.exec(t)) !== null) {
    const after = t.slice(m.index + inchNum.length).trimStart();
    if (!NON_TV.test(after)) return true;
  }
  return false;
}

// Excludes non-TV products (phones, accessories, stands, remotes, etc.)
function isNonTV(title) {
  const t = (title || '').toLowerCase();
  if (/\b(smartphone|celular|móvil|movil|teléfono|telefono|tablet|soporte\b|base\b|funda|cargador|cable\b|audífonos|audifonos|auricular|bocina|control\s+remoto|repuesto|accesorio)\b/.test(t)) return true;
  // Remote controls often start with "control" in MeLi MX titles
  if (/^control\b/.test(t)) return true;
  return false;
}

// Extract TV screen size in inches from title (e.g. "65 pulgadas", '65"', "65pulg")
function extractTVSize(title) {
  const t = (title || '').toLowerCase();
  const m =
    t.match(/(\d{2})\s*(?:"|"|"|pulg(?:adas)?)/i) ||
    t.match(/\b(32|40|43|50|55|58|65|70|75|85)\b/);
  return m ? parseInt(m[1], 10) : null;
}

function checkTechWords(t, techWords) {
  for (const word of techWords) {
    const aliases = TECH_ALIASES[word.toLowerCase()] || [word.toLowerCase()];
    if (!aliases.some(a => new RegExp('\\b' + a + '\\b').test(t))) return false;
  }
  return true;
}

// Check title contains TCL + inch + all tech words (smart OS not required).
function titleMatches(title, inchNum, techWords) {
  if (!title) return false;
  const t = title.toLowerCase();
  if (!t.includes('tcl')) return false;
  if (!inchInTitle(t, inchNum)) return false;
  return checkTechWords(t, techWords);
}

// Fallback: TCL + tech only, no inch requirement.
function titleMatchesNoInch(title, techWords) {
  if (!title) return false;
  const t = title.toLowerCase();
  if (!t.includes('tcl')) return false;
  return checkTechWords(t, techWords);
}

function isRefurbished(title) {
  return /(reacondicionado|remanufacturado)/i.test(title || '');
}

function baseFilter(p) {
  return p.price !== null && p.price > 0 &&
    !p.isUsed && !p.isInternational && !isNonTV(p.title) && !isRefurbished(p.title);
}

function findMinPriceProduct(products, inchNum, techWords) {
  const candidates = products.filter(p => baseFilter(p) && titleMatches(p.title, inchNum, techWords));
  if (!candidates.length) return null;
  return candidates.reduce((best, p) => (p.price < best.price ? p : best));
}

// Fallback: from a broad search, return the product whose size is closest to targetInch.
// Tie-break by price. Requires tech terms + smart but not exact inch match.
function findClosestSizeProduct(products, targetInch, techWords) {
  const target = parseInt(targetInch, 10);
  const candidates = products.filter(p => baseFilter(p) && titleMatchesNoInch(p.title, techWords));
  if (!candidates.length) return null;

  const withSize = candidates.map(p => ({ p, size: extractTVSize(p.title) })).filter(x => x.size);
  if (!withSize.length) return candidates.reduce((a, b) => (a.price < b.price ? a : b));

  return withSize.reduce((best, cur) => {
    const dBest = Math.abs(best.size - target);
    const dCur  = Math.abs(cur.size  - target);
    if (dCur < dBest) return cur;
    if (dCur === dBest && cur.p.price < best.p.price) return cur;
    return best;
  }).p;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet(SOURCE_SHEET);

  // Build product list from rows 7-25 (0-based indices 6-24), skip index 14 (row 15)
  const rows = [];
  for (let r = 6; r <= 24; r++) {
    if (r === 14) continue;

    const inch    = String(cellVal(ws, r, C_INCH));
    const tech    = String(cellVal(ws, r, C_TECH)).trim();
    const smart   = String(cellVal(ws, r, C_SMART)).trim();
    const inchNum = extractInchNum(inch);

    if (!inchNum) continue; // skip truly empty rows

    const techWords  = tech.split(/\s+/).filter(Boolean);
    const searchTerm = `TCL ${inchNum} ${tech} ${smart}`.replace(/\s+/g, ' ').trim();

    rows.push({
      r,
      concepto: String(cellVal(ws, r, C_CONCEPTO)),
      brand:    String(cellVal(ws, r, C_BRAND)),
      model:    String(cellVal(ws, r, C_MODEL)),
      inch, tech, smart,
      rrp:     cellVal(ws, r, C_RRP),
      iva:     cellVal(ws, r, C_IVA),
      dm:      cellVal(ws, r, C_DM),
      gossInv: cellVal(ws, r, C_GOSSINV),
      inchNum, techWords, searchTerm,
      minTitle: null, minPrice: null,
    });
  }

  console.log(`\n📋 ${rows.length} productos a buscar en MeLi ${COUNTRY}\n`);

  // Scrape each product
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    console.log(`\n[${i + 1}/${rows.length}] "${row.searchTerm}"`);

    try {
      const scraped = await scrape(row.searchTerm, COUNTRY);
      let best = findMinPriceProduct(scraped, row.inchNum, row.techWords);

      if (best) {
        row.minTitle = best.title;
        row.minPrice = best.price;
        console.log(`  ✅ Precio mín: $${best.price} — ${best.title}`);
      } else {
        // Fallback: search without inch, match by tech only
        const fallbackTerm = `TCL ${row.tech} ${row.smart}`.replace(/\s+/g, ' ').trim();
        console.log(`  ⚠️  Sin coincidencias. Fallback: "${fallbackTerm}"...`);
        await sleep(DELAY_MS);
        const scraped2 = await scrape(fallbackTerm, COUNTRY);
        best = findClosestSizeProduct(scraped2, row.inchNum, row.techWords);

        if (best) {
          row.minTitle = best.title;
          row.minPrice = best.price;
          console.log(`  ✅ Fallback precio mín: $${best.price} — ${best.title}`);
        } else {
          row.minTitle = 'No encontrado';
          console.log(`  ❌ Sin resultados incluso con fallback`);
        }
      }
    } catch (err) {
      row.minTitle = `Error: ${err.message}`;
      console.error(`  ❌ ${err.message}`);
    }

    // Write progress to file after each row
    writeResultados(wb, rows);
    await wb.xlsx.writeFile(FILE);

    if (i < rows.length - 1) {
      console.log(`  ⏳ Esperando ${DELAY_MS / 1000}s...\n`);
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n✅ Listo. Archivo guardado: ${FILE}`);
}

function writeResultados(wb, rows) {
  const existing = wb.getWorksheet(TARGET_SHEET);
  if (existing) wb.removeWorksheet(existing.id);

  const ws = wb.addWorksheet(TARGET_SHEET);

  ws.addRow([
    'Concepto', 'Brand', 'Model#', 'Inch', 'Tech', 'Smart',
    'RRP', 'IVA', 'DM%', 'Goss Inv. (x1.16)',
    'TCL Min Título', 'TCL Min Precio MXN',
  ]);

  for (const row of rows) {
    const gossNum = typeof row.gossInv === 'number' ? row.gossInv : parseFloat(row.gossInv) || 0;
    ws.addRow([
      row.concepto, row.brand, row.model, row.inch, row.tech, row.smart,
      row.rrp, row.iva, row.dm,
      gossNum * 1.16,
      row.minTitle ?? '',
      row.minPrice ?? '',
    ]);
  }
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  process.exit(1);
});
