#!/usr/bin/env node
/**
 * Lee un Excel, busca cada producto (columna B, desde fila 5) en MeLi AR,
 * y escribe el precio mínimo encontrado en la columna AF de la misma fila.
 *
 * Uso: node scraper/src/excel-price-fill.js <ruta-al-excel>
 */

const path = require('path');
const { execFile } = require('child_process');
const ExcelJS = require('exceljs');

// ── Configuración ──────────────────────────────────────────────────────────
const QUERY_SCRIPTS  = {
  meli:      path.join(__dirname, 'query.js'),
  tiendamia: path.join(__dirname, 'tiendamia-query.js'),
};
const START_ROW      = 5;          // fila Excel donde empiezan los productos (1-based)
const COL_PRODUCT    = 'B';        // columna con el nombre del producto
const COL_PRICE      = 'AF';       // columna donde se escribe el precio mínimo
const DELAY_MS       = 15000;      // pausa entre búsquedas (ms) para no ser bloqueados
const COUNTRY        = 'AR';
const COL_REFERENCE  = 'AA';       // columna con el precio de referencia (umbral -40%)
// ──────────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runQuery(searchTerm, queryScript, usesCountry) {
  const args = usesCountry ? [queryScript, searchTerm, COUNTRY] : [queryScript, searchTerm];
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      args,
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (stderr) process.stderr.write(stderr);
        if (err) return reject(new Error(err.message));
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('JSON inválido en stdout: ' + stdout.slice(0, 200)));
        }
      }
    );
  });
}

// Calificadores genéricos que NO son específicos del modelo
const GENERIC = new Set([
  'eu', 'gl', 'us', 'mx', '2k', '4k', 'uhd', 'fhd', 'qhd', 'hd',
  'wet', 'dry', 'dual', 'zone', 'smart', 'plus', 'lite', 'ultra', 'max', 'mini', 'pro',
  'with', 'para', 'the', 'and', 'con', 'for',
]);

function extractTokens(searchTerm) {
  // Separar por espacios, guiones y underscores, pero NO por "+" para preservar "8+256", "4+128"
  const rawWords = searchTerm.toLowerCase().split(/[\s\-_]+/)
    .map(w => w.replace(/[.,;:!?]+$/, '')).filter(Boolean);

  const required = [];   // tokens que DEBEN aparecer en el título
  const optional = [];   // tokens que ayudan pero no bloquean

  for (const w of rawWords) {
    if (w.length < 2) continue;
    if (GENERIC.has(w)) continue;

    const hasDigit  = /\d/.test(w);
    const hasLetter = /[a-z]/i.test(w);

    if (/^\d{4}$/.test(w)) continue;                           // años como 2026 → ignorar
    if (/^\d+\.\d+$/.test(w)) { optional.push(w); continue; } // decimales "9.7" (tamaño pantalla) → opcional
    if (/^\d+\+\d+$/.test(w)) { required.push(w); continue; } // "8+256", "4+128" → obligatorio
    if (/^\d{1,3}$/.test(w))  { required.push(w); continue; } // números de modelo "6", "15", "13" → obligatorio
    if (hasDigit && hasLetter) { required.push(w); continue; } // G27i, 4GB, S40C, 5G, 15C → obligatorio
    if (!hasDigit && w.length >= 3) optional.push(w);          // palabras → opcional
  }

  return { required, optional };
}

function titleMatchesSearch(title, tokens) {
  if (!title) return false;
  const t = title.toLowerCase();
  return tokens.every((tok) => {
    // Storage "X+Y": acepta "4+64" exacto O "4gb"+"64gb" separados (MeLi usa ambos formatos)
    if (/^\d+\+\d+$/.test(tok)) {
      if (t.includes(tok)) return true;
      const [x, y] = tok.split('+');
      return t.includes(x + 'gb') && t.includes(y + 'gb');
    }
    // Números de modelo (ej: "15", "13"): word boundary para no coincidir con "150" o "512"
    if (/^\d+$/.test(tok)) return new RegExp(`\\b${tok}\\b`).test(t);
    return t.includes(tok);
  });
}

// Excluye accesorios y repuestos con "para" en cualquier parte del título
// (ej: "Kit de paños para aspirador", "Funda Para Tablet", "Para Xiaomi S40C")
function isAccessory(product) {
  const title = (product.title || '').toLowerCase();
  return /\bpara\b/.test(title);
}

function isSparePart(product) {
  const title = (product.title || '').toLowerCase();
  return /\brepuestos?\b/.test(title) || /\baccesorios?\b/.test(title) || /\bfor\b/.test(title);
}

function minPrice(products, searchTerm, referencePrice) {
  const { required, optional } = extractTokens(searchTerm);

  // Excluir accesorios, repuestos, usados e internacionales antes de filtrar por modelo
  const base = products.filter((p) => !isAccessory(p) && !isSparePart(p) && !p.isUsed && !p.isInternational);

  let matched;
  if (required.length > 0) {
    // Con tokens obligatorios: filtro estricto, sin fallback
    matched = base.filter((p) => titleMatchesSearch(p.title, required));
  } else if (optional.length > 0) {
    // Sin tokens obligatorios: usar opcionales como filtro
    matched = base.filter((p) => titleMatchesSearch(p.title, optional));
  } else {
    matched = base;
  }

  let prices = matched.map((p) => p.price).filter((v) => typeof v === 'number' && v > 0);

  // Descartar precios que estén 40% o más por debajo del precio de referencia (columna AA)
  let removedByThreshold = 0;
  if (referencePrice > 0) {
    const threshold = referencePrice * 0.60;
    const filtered = prices.filter((p) => p >= threshold);
    removedByThreshold = prices.length - filtered.length;
    prices = filtered;
  }

  return { min: prices.length ? Math.min(...prices) : null, matchCount: matched.length, total: products.length, removedByThreshold };
}

async function main() {
  const excelPath = process.argv[2];
  if (!excelPath) {
    console.error('Uso: node excel-price-fill.js <ruta-al-excel> [--rows 9,15,27] [--sheet "Nombre"] [--price-col AP] [--start-row 86] [--end-row 300] [--source meli|tiendamia]');
    process.exit(1);
  }

  const arg = (flag) => { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : null; };

  // Parse optional --rows argument
  const onlyRows = arg('--rows') ? new Set(arg('--rows').split(',').map(Number)) : null;

  // Parse optional sheet/column/row overrides
  const priceCol    = arg('--price-col') || COL_PRICE;
  const startRowArg = arg('--start-row') ? Number(arg('--start-row')) : START_ROW;
  const endRowArg   = arg('--end-row') ? Number(arg('--end-row')) : null;
  const sheetArg    = arg('--sheet') || null;

  // Parse source: meli (default) or tiendamia
  const source = arg('--source') || 'meli';
  if (!QUERY_SCRIPTS[source]) {
    console.error(`Fuente desconocida: "${source}". Opciones: meli, tiendamia`);
    process.exit(1);
  }
  const queryScript = QUERY_SCRIPTS[source];
  const usesCountry = source === 'meli';
  console.log(`Fuente: ${source}`);

  const absPath = path.resolve(excelPath);
  console.log(`\nLeyendo: ${absPath}`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(absPath);

  let worksheet;
  if (sheetArg) {
    worksheet = workbook.getWorksheet(sheetArg);
    if (!worksheet) {
      console.error(`Hoja "${sheetArg}" no encontrada. Hojas disponibles: ${workbook.worksheets.map(w => w.name).join(', ')}`);
      process.exit(1);
    }
  } else {
    worksheet = workbook.worksheets[0];
  }
  console.log(`Hoja: ${worksheet.name}`);

  const lastRow  = endRowArg ? Math.min(endRowArg, worksheet.rowCount) : worksheet.rowCount;
  const firstRow = startRowArg;

  const rowsToProcess = onlyRows
    ? [...onlyRows].filter(r => r >= firstRow && r <= lastRow).sort((a, b) => a - b)
    : Array.from({ length: lastRow - firstRow + 1 }, (_, i) => firstRow + i);

  const total = rowsToProcess.length;
  console.log(`Productos a procesar: ${total} (filas: ${rowsToProcess.join(', ')})\n`);

  for (let i = 0; i < rowsToProcess.length; i++) {
    const row  = rowsToProcess[i];
    const cell = worksheet.getCell(`${COL_PRODUCT}${row}`);
    const name = cell?.value?.toString().trim();

    if (!name) {
      console.log(`Fila ${row}: celda vacía, omitiendo.`);
      continue;
    }

    console.log(`[${i + 1}/${total}] Buscando: "${name}"`);

    // Leer precio de referencia de columna AA
    const refCell = worksheet.getCell(`${COL_REFERENCE}${row}`);
    const referencePrice = (typeof refCell.value === 'number' && refCell.value > 0) ? refCell.value : 0;

    let products = [];
    try {
      products = await runQuery(name, queryScript, usesCountry);
    } catch (err) {
      console.error(`  ❌ Error en búsqueda: ${err.message}`);
    }

    const targetAddr = `${priceCol}${row}`;
    if (products.length > 0) {
      const intlCount = products.filter((p) => p.isInternational).length;
      const { min, matchCount, removedByThreshold } = minPrice(products, name, referencePrice);
      if (min !== null) {
        worksheet.getCell(targetAddr).value = min;
        const intlNote = intlCount > 0 ? ` (${intlCount} internacionales excluidos)` : '';
        const thresholdNote = removedByThreshold > 0 ? ` [${removedByThreshold} descartados por umbral -40%]` : '';
        console.log(`  ✅ Precio mínimo: ${min} (${matchCount} coincidentes de ${products.length}${intlNote}${thresholdNote})`);
      } else {
        worksheet.getCell(targetAddr).value = 'No encontrado';
        const intlNote = intlCount > 0 ? ` — ${intlCount} internacionales excluidos` : '';
        const thresholdNote = removedByThreshold > 0 ? ` — ${removedByThreshold} descartados por umbral -40%` : '';
        console.log(`  ⚠️  Sin resultados que coincidan con el modelo (${products.length} ignorados${intlNote}${thresholdNote})`);
      }
    } else {
      worksheet.getCell(targetAddr).value = 'No encontrado';
      console.log(`  ⚠️  Sin resultados`);
    }

    // Guardar después de cada fila para no perder progreso si se interrumpe
    await workbook.xlsx.writeFile(absPath);

    if (i < rowsToProcess.length - 1) {
      const nextRow  = rowsToProcess[i + 1];
      const nextCell = worksheet.getCell(`${COL_PRODUCT}${nextRow}`);
      if (nextCell?.value) {
        console.log(`  ⏳ Esperando ${DELAY_MS / 1000}s antes de la próxima búsqueda...\n`);
        await sleep(DELAY_MS);
      }
    }
  }

  console.log(`\n✅ Proceso completo. Excel guardado en: ${absPath}`);
}

main().catch((err) => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
