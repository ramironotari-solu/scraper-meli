# Plan de reestructuración: de prototipo a producto

> Análisis y plan técnico para separar el proyecto en backend y frontend y dejarlo encaminado como un desarrollo mantenible.
> Fecha: 2026-11-06 · Estado del repo analizado: `main` @ `6e488a0` + cambios sin commitear en el working tree.

---

## 1. Resumen ejecutivo

El proyecto **funciona y tiene lógica de negocio valiosa** (scrapers de 3 marketplaces, matching de modelos para el Excel y un resumen con IA). Pero hoy es un prototipo: la web y el scraping están acoplados mediante procesos hijos, no hay persistencia, tests, autenticación ni CI, y casi todo el trabajo de los últimos 7 meses **no está commiteado**.

**Propuesta:** monorepo con npm workspaces, separado en:

- **`apps/web`**: Next.js, solo UI.
- **`apps/api`**: backend en Node + TypeScript (Fastify). Expone una API HTTP, valida y encola trabajos.
- **`apps/worker`**: corre los scrapers con un pool de Chromium y guarda los resultados.
- **`packages/*`**: código compartido (tipos/contrato, scrapers, lógica de dominio y DB).

Se hace en **6 fases incrementales**. La app sigue funcionando al final de cada una. La fase 0 (asegurar lo existente y corregir bugs que hoy afectan datos) conviene hacerla ya.

---

## 2. Diagnóstico del estado actual

### 2.1 Cómo funciona hoy

```
┌──────────────────────── Next.js (un solo proceso) ────────────────────────┐
│                                                                            │
│  SearchForm.tsx (client, 414 líneas)                                       │
│     │  POST /api/search                    POST /api/summary               │
│     ▼                                          ▼                           │
│  route.ts ── spawn(node query.js …) ──┐    summary/route.ts ──► Anthropic   │
│              (espera hasta 120 s)     │    (recibe stats DEL CLIENTE)       │
└───────────────────────────────────────┼────────────────────────────────────┘
                                        ▼
                     scraper/src/{query,walmart-query,tiendamia-query}.js
                       └─ lanza Chromium nuevo en CADA intento (hasta 3)
                       └─ devuelve JSON por stdout, logs por stderr

Scripts sueltos (CLI): excel-price-fill.js, tcl-research.js, index.js, auth.js
```

### 2.2 Lo que está bien y hay que conservar

- **Walmart extrae desde `__NEXT_DATA__`** y usa el DOM solo como fallback. Es más robusto que depender solo de selectores.
- **Lógica de matching de modelos** (`excel-price-fill.js:57-97`, `tcl-research.js:40-127`). Es conocimiento de dominio real y vale la pena llevarlo a un paquete con tests.
- **Detección de bloqueos y reintentos con rotación de perfil.** La idea es correcta; solo falta centralizarla.
- **Contrato de `Product` ya normalizado** entre marketplaces (`src/lib/types.ts`). Es una buena base para el contrato de la API.
- **Guardado incremental** en los scripts de Excel: si se corta el proceso, no se pierde el progreso.

### 2.3 Problemas, por severidad

#### 🔴 Críticos (afectan datos, seguridad o la integridad del código)

| # | Problema | Dónde | Impacto |
|---|----------|-------|---------|
| C1 | **El scraper de MeLi nunca devuelve `isUsed` ni `isInternational`**, pero los scripts de Excel filtran por esos campos | `scraper/src/scraper.js:41-135` vs `excel-price-fill.js:115` y `tcl-research.js:101` | El filtro no hace nada: **el precio mínimo que se escribe en el Excel puede venir de un producto usado o internacional**. Afecta decisiones de negocio hoy. |
| C2 | **Todo el trabajo desde abril está sin commitear**: 8 archivos nuevos (Walmart, Tiendamia, Excel, TCL, Docker) y unas 2.300 líneas modificadas | working tree | Si se rompe o se pierde el disco, se pierde todo. No hay historial para revertir. |
| C3 | **Los secretos se copian a la imagen Docker**: `.dockerignore` no excluye `.env*` y el `Dockerfile` hace `COPY . .` | `.dockerignore`, `Dockerfile` | `ANTHROPIC_API_KEY` y las credenciales de MeLi quedan dentro de la imagen. |
| C4 | **API pública sin autenticación ni rate limiting** | `src/app/api/*` | Si se despliega, cualquiera puede lanzar Chromium en el servidor (DoS) o gastar créditos de Anthropic. |
| C5 | **El resumen con IA se calcula con stats que manda el cliente** | `summary/route.ts:15-22` | El cliente puede mandar cualquier cosa y no hay forma de auditar qué se analizó. El `query` va sin sanitizar al prompt. |

#### 🟠 Altos (arquitectura y mantenibilidad)

| # | Problema | Dónde |
|---|----------|-------|
| A1 | **Acoplamiento por procesos hijos**: la API hace `spawn` de un script por búsqueda, parsea stdout y muestra en la UI los últimos 500 caracteres de stderr como mensaje de error | `route.ts:97-123` |
| A2 | **La request HTTP queda colgada hasta 120 s** mientras corre el scraping. No hay cola, ni progreso, ni cancelación, y nada limita cuántas búsquedas corren a la vez (N usuarios = N Chromium) | `route.ts:5` |
| A3 | **Chromium se lanza de cero en cada intento** (hasta 3 por búsqueda). Es lento y gasta mucha memoria | `scraper.js:153`, `walmart-scraper.js:213`, `tiendamia-scraper.js:91` |
| A4 | **La rotación de UA y proxies no rota**: el índice vive en memoria del módulo y cada búsqueda es un proceso nuevo, así que **el primer intento usa siempre el mismo perfil y el mismo proxy** | `rotation.js:43-54, 115-124` |
| A5 | **Los 3 scrapers duplican alrededor del 60% del código**: `attempt()`, el loop de reintentos, los argumentos de lanzamiento, la detección de bloqueo, `sleep` y `saveDebugHtml`. Además ya divergieron: MeLi usa `headless: 'new'` y warm-up, los otros no | los 3 `*-scraper.js` |
| A6 | **El catálogo de marketplaces y países está repetido en 5 lugares** | `SearchForm.tsx:9-39`, `route.ts:7-11`, `summary/route.ts:4-8`, `config.js`, `walmart-scraper.js:11-14` |
| A7 | **Conocimiento de cada marketplace filtrado a la API**: por ejemplo, la heurística de `hasMore` (`=== 50`, `>= 40`) y qué argumentos acepta cada script | `route.ts:42-53` |
| A8 | **Sin persistencia**: no hay historial, ni caché, ni forma de comparar precios en el tiempo. Cada búsqueda se pierde al recargar | — |
| A9 | **Cero tests.** Hay muchas funciones puras ideales para testear (`parsePrice`, `extractTokens`, `titleMatchesSearch`, `extractTVSize`, `computeStats`) | — |
| A10 | **Dos lenguajes y dos instalaciones**: el scraper está en JS CommonJS y el front en TS. Los tipos se comparten "por convención" y hay dos `node_modules` con dependencias repetidas (`exceljs`) | `scraper/`, raíz |

#### 🟡 Medios (bugs y deuda puntual)

| # | Problema | Dónde |
|---|----------|-------|
| M1 | Tiendamia aparece como "Mercado Libre" en el prompt del resumen | `summary/route.ts:24` |
| M2 | División por cero cuando no hay resultados: muestra `NaN%` en la UI y en el prompt | `MarketSummary.tsx:32-33`, `summary/route.ts:25-26` |
| M3 | **No se maneja la moneda**: todos los precios se muestran con `$` y formato `es-AR`, sean USD, MXN o BRL | `ProductCard.tsx:3-5`, `MarketSummary.tsx:3-5` |
| M4 | `hasFull` tiene dos significados: en MeLi es "FULL" y en Walmart "entrega hoy/mañana". La UI lo etiqueta como "2-Day", que no coincide con ninguno de los dos | `walmart-scraper.js:81-85`, `MarketSummary.tsx:34` |
| M5 | `SearchForm.tsx` es un god component: 414 líneas, unos 20 `useState`, fetch, filtros, ordenamiento y export a XLSX en el mismo archivo. `exceljs` se carga entero en el bundle del cliente | `SearchForm.tsx` |
| M6 | El warm-up de MeLi reemplaza `listado.` por `www.` pero en Brasil el host es `lista.`, así que el reemplazo no aplica | `scraper.js:171` |
| M7 | Los scripts de Excel **sobrescriben el archivo de entrada** | `excel-price-fill.js:242`, `tcl-research.js:203` |
| M8 | `tcl-research.js` tiene filas, columnas y ruta hardcodeadas (filas 7-25, salta la 15). Es un script de un solo uso mezclado con código del producto | `tcl-research.js:13-20, 136-137` |
| M9 | El modelo de IA está hardcodeado (`claude-haiku-4-5-20251001`) | `summary/route.ts:43` |
| M10 | `.gitignore` tiene `.env*`, que también ignora `scraper/.env.example`: la plantilla de configuración no está versionada | `.gitignore:34` |
| M11 | Código muerto: `cheerio` (dependencia sin uso), `pLimit` (sin uso) y `auth.js`, que obtiene un token de MeLi que ningún scraper usa | `scraper/package.json`, `utils.js:11`, `auth.js` |
| M12 | `scraper/data/` mezcla datos de negocio de entrada (`chiq_tv_forecast.xlsx`), resultados y HTML de debug | `scraper/data/` |
| M13 | Dockerfile de una sola etapa, corre como root, incluye las devDependencies y Chromium corre con `--no-sandbox` | `Dockerfile` |
| M14 | El README es el de `create-next-app` y no documenta el proyecto | `README.md` |

---

## 3. Arquitectura objetivo

### 3.1 ¿Por qué separar backend y frontend?

Next.js puede ser full-stack, pero **el scraping no encaja en el ciclo de vida de una request web**:

- Es **lento**: entre 10 y 60 s por búsqueda, y bastante más con reintentos.
- Es **pesado**: cada Chromium ocupa entre 200 y 500 MB de RAM.
- Necesita **estado**: un pool de navegadores, rotación de proxies y una cola.
- Escala distinto que la UI: 1 web alcanza para muchos usuarios, pero los workers se escalan según la cantidad de búsquedas.

Por eso: **la web solo muestra y pide; la API valida, persiste y encola; el worker scrapea.** Además, cada parte se puede desplegar y reiniciar por separado.

> Alternativa descartada: dejar los Route Handlers de Next como backend y solo refactorizar el código. Resuelve la duplicación, pero no los problemas A1-A3 ni A8, y ata el scraping a donde se despliegue la web (en Vercel, por ejemplo, Puppeteer no corre bien).

### 3.2 Diagrama

```
                ┌───────────────┐
  Usuario ────► │   apps/web    │  Next.js 16 · solo UI
                │ (Next.js)     │  rewrites /api/* → apps/api (mismo origen, sin CORS)
                └──────┬────────┘
                       │ HTTP/JSON (contrato en packages/shared)
                ┌──────▼────────┐
                │   apps/api    │  Fastify · auth · validación zod · rate limit
                │               │  calcula stats · pide el resumen IA · export XLSX
                └──┬─────────┬──┘
          encola   │         │ lee/escribe
                ┌──▼───┐  ┌──▼─────────┐
                │ cola │  │ PostgreSQL │  búsquedas, productos, resúmenes, jobs batch
                │(pg-  │  └──▲─────────┘
                │ boss)│     │ guarda resultados
                └──┬───┘     │
                ┌──▼─────────┴──┐
                │  apps/worker  │  pool de Chromium reutilizable · rotación real
                │               │  usa packages/scrapers
                └───────────────┘
```

### 3.3 Estructura del repo

```
scraper-meli/
├── apps/
│   ├── web/                    # Next.js: páginas, componentes, hooks. Sin lógica de scraping
│   ├── api/                    # Fastify: rutas, auth, validación, orquestación
│   └── worker/                 # Consume la cola, maneja Chromium, persiste resultados
├── packages/
│   ├── shared/                 # Esquemas zod + tipos TS (el contrato entre front y back)
│   ├── scrapers/               # Motor común + un adaptador por marketplace
│   │   ├── engine/             #   browser-pool, retry, rotation, block-detection, debug-snapshot
│   │   └── adapters/           #   meli/, walmart/, tiendamia/ (cada uno con fixtures de test)
│   ├── core/                   # Dominio puro: stats, matching de modelos, filtros, export XLSX
│   └── db/                     # Esquema Drizzle, migraciones, cliente
├── scripts/                    # CLIs puntuales (excel-price-fill, tcl-research) sobre packages/*
├── docker/                     # Un Dockerfile multi-stage por app
├── docker-compose.yml          # postgres + api + worker + web para desarrollo local
├── .github/workflows/ci.yml    # lint · typecheck · test · build
└── docs/                       # Este plan, arquitectura y runbook
```

### 3.4 Stack propuesto

| Capa | Elección | Por qué |
|------|----------|---------|
| Monorepo | **npm workspaces** | Ya se usa npm; no suma herramientas. Si los builds se vuelven lentos, se agrega Turborepo después. |
| Lenguaje | **TypeScript en todo** | Contrato compartido y verificado entre front y back. Hoy el scraper en JS no tiene tipos. |
| Backend HTTP | **Fastify** | Liviano, con validación por schema, logging con pino incluido y buen soporte de TS. NestJS es demasiado para el tamaño del equipo. |
| Validación | **zod** | Un solo esquema sirve para validar en la API, tipar el front y generar documentación OpenAPI. |
| Base de datos | **PostgreSQL + Drizzle ORM** | Drizzle es liviano y cercano a SQL, con migraciones versionadas. Postgres sirve también como cola. |
| Cola de jobs | **pg-boss** (sobre Postgres) | Evita sumar Redis. Tiene reintentos, concurrencia y jobs programados, que alcanza para este volumen. |
| Scraping | **Puppeteer + stealth** (lo actual), con **pool de navegadores** | No hace falta cambiar de herramienta. El cambio grande es reutilizar el navegador y abrir un contexto aislado por job. |
| Frontend data | **TanStack Query** | Polling del estado de los jobs, caché y reintentos sin escribirlos a mano. |
| Tests | **Vitest** | Rápido y compatible con TS y ESM. Los extractores se testean con fixtures de HTML guardado. |
| Logs | **pino** (JSON estructurado) | Permite filtrar por marketplace, búsqueda o error. Hoy son `console.log` con emojis. |
| CI | **GitHub Actions** | El repo ya está en GitHub (`ramironotari-solu/scrapper-meli`). |

### 3.5 Contrato de la API (borrador)

Es **asincrónico desde el día 1**, aunque en la primera versión la cola esté en memoria. Así el contrato no cambia cuando se agregue Postgres.

```
GET    /health                         → { ok, version, db, queue }
GET    /marketplaces                   → catálogo único: marketplaces, países, moneda, capacidades
POST   /searches                       { marketplace, country, query, page? }
                                       → 202 { id, status: "queued" }
GET    /searches/:id                   → { id, status, params, products?, stats?, error?, timings }
GET    /searches/:id/summary           → { summary, model }   (se genera una vez y se cachea)
GET    /searches/:id/export.xlsx       → archivo (el export sale del cliente)
GET    /searches?cursor=&limit=        → historial paginado
POST   /batch-jobs        (multipart)  → fase 5: subir Excel + mapeo de columnas
GET    /batch-jobs/:id                 → progreso por fila
GET    /batch-jobs/:id/result.xlsx     → Excel resultante (nunca se pisa el original)
```

Los errores tienen códigos tipados en lugar de un recorte de stderr:
`BLOCKED`, `NO_RESULTS`, `TIMEOUT`, `SELECTOR_CHANGED`, `INVALID_INPUT`, `RATE_LIMITED`, `INTERNAL`.

### 3.6 Modelo de producto normalizado (`packages/shared`)

Resuelve M3 y M4, y suma los campos que hoy faltan o solo existen en algunos scrapers:

```ts
export const Product = z.object({
  marketplace:     MarketplaceId,            // 'meli' | 'walmart' | 'tiendamia'
  country:         CountryCode,
  externalId:      z.string().nullable(),    // MLA123…, item id de Walmart, ASIN
  title:           z.string(),
  brand:           z.string().nullable(),
  url:             z.string().url().nullable(),
  thumbnail:       z.string().url().nullable(),
  price:           z.number().positive().nullable(),
  originalPrice:   z.number().positive().nullable(),
  currency:        Currency,                 // ARS, MXN, BRL, COP, CLP, UYU, USD
  discountPct:     z.number().int().min(0).max(100).nullable(),
  rating:          z.number().min(0).max(5).nullable(),
  reviewCount:     z.number().int().nonnegative().nullable(),
  seller:          z.string().nullable(),
  condition:       z.enum(['new', 'used', 'refurbished', 'unknown']),  // corrige C1
  isInternational: z.boolean(),                                        // corrige C1
  isAd:            z.boolean(),
  shipping: z.object({
    free:  z.boolean(),
    fast:  z.boolean(),          // MeLi FULL / Walmart mismo día o día siguiente; la UI rotula según el marketplace
    label: z.string().nullable() // texto original, si existe
  }),
});
```

### 3.7 Interfaz de adaptador (`packages/scrapers`)

Cada marketplace declara **solo lo que lo hace distinto**. Reintentos, rotación, pool, snapshots de debug y errores tipados viven en el motor común:

```ts
interface MarketplaceAdapter {
  id: MarketplaceId;
  name: string;
  countries: Record<CountryCode, { name: string; currency: Currency; locale: string; baseUrl: string }>;
  capabilities: { pagination: boolean; rating: boolean; shipping: 'flags' | 'text' | 'none' };

  buildSearchUrl(country: CountryConfig, query: string, page: number): string;
  warmupUrl?(country: CountryConfig): string;          // reemplaza el replace() frágil (M6)
  detectBlock(page: Page): Promise<boolean>;
  detectEmpty(page: Page): Promise<boolean>;
  extract(page: Page): Promise<RawItem[]>;             // corre en el navegador: solo lee el DOM/JSON
  normalize(raw: RawItem, ctx: ScrapeContext): Product; // corre en Node: función pura y testeable
  hasMore(products: Product[], page: number): boolean;  // saca la heurística de la API (A7)
}

// Motor común
runScrape(adapter, params, { browserPool, rotator, retries, logger }): Promise<ScrapeResult>
```

Separar `extract` (en el navegador) de `normalize` (en Node) permite **testear el parseo sin abrir un navegador**, con el HTML de debug que ya existe (`meli_debug.html`, `tiendamia_debug.html`) como fixture.

### 3.8 Modelo de datos (fase 3)

```
searches       id · marketplace · country · query · page · status · error_code · error_message
               attempts · used_proxy · result_count · created_at · started_at · finished_at
search_results id · search_id → searches · position · <campos de Product> · raw (jsonb)
summaries      search_id → searches · model · text · created_at
batch_jobs     id · filename · column_mapping (jsonb) · status · created_at        (fase 5)
batch_rows     id · job_id → batch_jobs · row_number · query · result (jsonb) · status
```

Con esto, el "historial de búsquedas" que estaba pendiente sale casi gratis. También se puede **cachear**: si la misma búsqueda se hizo hace menos de X horas, se devuelve el resultado guardado sin volver a scrapear, lo que además reduce el riesgo de bloqueo.

---

## 4. Plan por fases

Cada fase termina con la app funcionando y mergeada a `main`. Los tamaños son orientativos (S ≈ 1 día, M ≈ 2-4 días, L ≈ 1 semana).

### Fase 0: Asegurar lo existente · S · ✅ **hecha (2026-11-06, rama `chore/fase-0`)**

**Objetivo:** no perder trabajo y dejar de producir datos incorrectos.

- [x] Commitear el working tree en commits por tema (Walmart, Tiendamia, scripts de Excel, Docker, anti-bot de MeLi, migración a exceljs).
- [x] **Corregir C1**: el scraper de MeLi ahora devuelve `condition`, `isUsed` e `isInternational`. Se verificó contra páginas reales de MeLi AR.
- [x] Corregir C3: `.env*`, `**/.env*` y `scraper/proxies.txt` agregados a `.dockerignore`.
- [x] Corregir M10: `!.env.example` en `.gitignore`, `.env.example` nuevo en la raíz y `scraper/.env.example` actualizado al flujo `client_credentials`.
- [x] Corregir M1 y M2.
- [ ] Mergear `chore/fase-0` a `main`, subirla a GitHub y crear `refactor/monorepo` desde `main`. *(Pendiente de confirmación.)*
- [ ] Volver a correr las filas del Excel cargadas antes de este fix. *(Bloqueado: ver "Hallazgos" más abajo.)*
- [ ] Si alguna imagen Docker se subió a un registry, **rotar las claves**. *(Pendiente de confirmación.)*

**Hallazgos de la fase 0:**

- **Los selectores de MeLi habían quedado desactualizados.** Además de C1, el extractor devolvía 0 en rating (0 de 59), envío gratis (0 de 55), FULL (0 de 20) y anuncios (0 de 16), porque MeLi migró a `poly-component__shipping-v2`, `review-compacted` y `ads-promotions`. Por eso el resumen de mercado de MeLi mostraba "0% envío gratis" y se lo pasaba así a la IA. Ya está corregido. **Esto es justamente lo que tienen que detectar los tests con fixtures de la fase 2.**
- **MeLi bloquea el scraping desde la IP actual** con un muro de login ("Para continuar, ingresa a tu cuenta") que se sirve desde su frontend `suspicious-traffic`. Desde un Chrome normal la misma búsqueda carga bien. Antes, el scraper lo reportaba como "sin resultados"; ahora lo reporta como `BLOCKED`. **Sin proxies, hoy no se puede scrapear MeLi desde esta máquina**, así que la decisión abierta n.º 2 (proxies) pasa a ser prioritaria.
- En la búsqueda "iphone 13", **43 de los 48 resultados son reacondicionados**. Los precios mínimos cargados antes de este fix pueden estar muy por debajo del precio de un equipo nuevo.

**Listo cuando:** `git status` está limpio, el Excel no toma usados ni internacionales y la imagen Docker no contiene secretos.

### Fase 1: Monorepo y tooling · M

**Objetivo:** tener la estructura base y las herramientas sin cambiar el comportamiento.

- [ ] Configurar npm workspaces y mover la app Next.js a `apps/web` y `scraper/src` a `packages/scrapers` (todavía en JS).
- [ ] Crear `packages/shared` con los esquemas zod de `Product`, `MarketStats`, `SearchRequest` y el catálogo de marketplaces (resuelve A6).
- [ ] Crear `tsconfig.base.json`, ESLint compartido, Prettier y Vitest.
- [ ] Armar el CI en GitHub Actions: `lint`, `typecheck`, `test` y `build` en cada PR.
- [ ] Escribir los primeros tests de las funciones puras actuales (parsers de precio, `extractTokens`, `titleMatchesSearch`, `computeStats`) **antes** de tocarlas, como red de seguridad.
- [ ] Borrar el código muerto (M11) y reescribir el README (M14).

**Listo cuando:** `npm run dev` levanta la web como hoy, el CI pasa y hay tests de las funciones puras.

### Fase 2: Backend API y motor de scraping · L

**Objetivo:** que la web deje de hacer `spawn` y hable con una API real.

- [ ] Migrar `packages/scrapers` a TypeScript, con el **motor común** (pool de navegadores, rotación real, reintentos y errores tipados) y los **3 adaptadores** (resuelve A3, A4 y A5).
- [ ] Mover la lógica pura a `packages/core`: `computeStats`, matching de modelos y export a XLSX.
- [ ] Crear `apps/api` con Fastify: endpoints `/health`, `/marketplaces`, `/searches` y `/searches/:id`, validados con zod.
- [ ] Usar una cola **en memoria** con límite de concurrencia (por ejemplo 2 búsquedas a la vez) y un worker en el mismo proceso. El contrato ya es asincrónico.
- [ ] Hacer que el resumen IA se genere **en el servidor** a partir de los resultados guardados (resuelve C5) y pasar el modelo a una variable de entorno (M9).
- [ ] Configurar logs con pino y validar la configuración con zod al arrancar (si falta una variable, falla al inicio y no en runtime).
- [ ] En `apps/web`, configurar `rewrites` de `/api/*` hacia la API, eliminar los Route Handlers actuales y hacer polling de `/searches/:id`.
- [ ] Escribir tests de `normalize()` por adaptador con fixtures de HTML guardado.

**Listo cuando:** la web funciona igual que hoy pero contra `apps/api`, no queda ningún `spawn` y una segunda búsqueda simultánea espera en la cola en vez de lanzar otro Chromium.

### Fase 3: Persistencia y worker separado · M/L

**Objetivo:** tener historial, caché y un worker que se pueda escalar o reiniciar sin tirar la API.

- [ ] Crear `packages/db`: esquema Drizzle con las tablas `searches`, `search_results` y `summaries`, más las migraciones.
- [ ] Reemplazar la cola en memoria por **pg-boss** y extraer `apps/worker` como proceso propio.
- [ ] Agregar caché de búsquedas recientes (TTL configurable).
- [ ] Endpoint `GET /searches` para el historial.
- [ ] Agregar un `docker-compose.yml` para desarrollo: postgres, api, worker y web.
- [ ] Registrar la **tasa de bloqueo por marketplace** (intentos, bloqueos y duración). Es el indicador clave de salud de un scraper.

**Listo cuando:** si se reinicia el worker no se pierden búsquedas encoladas y el historial persiste entre sesiones.

### Fase 4: Refactor del frontend · M

**Objetivo:** una UI mantenible y completa.

- [ ] Partir `SearchForm.tsx` en `SearchBar`, `FiltersBar`, `ResultsList`, `ExportButton` y `MarketSummary`, con hooks `useSearch()` y `useFilters()` (resuelve M5).
- [ ] Usar TanStack Query para crear la búsqueda, hacer polling del estado y cargar más resultados.
- [ ] Guardar el estado de la búsqueda en la URL (`?mp=meli&c=AR&q=...`) para poder compartir links.
- [ ] Formatear la moneda con `Intl.NumberFormat` según `product.currency` (resuelve M3) y rotular el envío rápido según el marketplace (M4).
- [ ] Agregar una página de **Historial** y que el export sea descargado desde la API (`exceljs` sale del bundle del cliente).
- [ ] Mostrar el progreso: en cola → scrapeando → listo, con el error tipado si falla.
- [ ] Definir para qué sirve "Cliente nuevo / actual": hoy solo cambia el nombre del archivo. Decidir si se guarda como metadato de la búsqueda o se elimina.

**Listo cuando:** ningún componente pasa las ~150 líneas, los precios en USD y MXN se ven bien y el historial es navegable.

### Fase 5: Jobs batch de Excel como feature · L

**Objetivo:** que `excel-price-fill` y `tcl-research` dejen de ser scripts que solo se pueden correr desde una terminal.

- [ ] UI para subir un Excel, elegir la hoja y mapear columnas (producto, precio de referencia y columna destino), con el marketplace y el país.
- [ ] Usar el motor de matching de `packages/core` con tests, unificando las dos variantes actuales (genérica y TV/TCL) en reglas configurables.
- [ ] El job batch encola una búsqueda por fila, respeta un delay entre búsquedas, muestra el progreso fila por fila y permite reanudar si se corta.
- [ ] Generar el resultado como **Excel nuevo para descargar**, sin pisar el original (resuelve M7).
- [ ] Mantener `scripts/` como CLIs finos sobre los paquetes para uso local; `tcl-research` queda como ejemplo o se archiva (M8).

**Listo cuando:** se puede repetir el flujo del Excel de TCL desde la web, sin tocar código.

### Fase 6: Despliegue y operación · M

**Objetivo:** que se pueda usar en producción de forma segura.

- [ ] Autenticación: si es solo para el equipo, login con Google Workspace (Auth.js en la web) y token hacia la API (resuelve C4).
- [ ] Rate limiting por usuario en la API y límite de búsquedas diarias.
- [ ] Dockerfiles multi-stage por app: la web con `output: 'standalone'` y el worker con Chromium, usuario no root y sin devDependencies (resuelve M13).
- [ ] Healthchecks, reinicio automático y alertas si la tasa de bloqueo supera un umbral.
- [ ] Gestionar los secretos desde la plataforma de despliegue, nunca dentro de la imagen.
- [ ] Escribir un runbook en `docs/`: cómo desplegar, cómo diagnosticar un bloqueo y qué hacer cuando un marketplace cambia su HTML.

**Listo cuando:** está desplegado, solo entra el equipo y hay alertas si un marketplace empieza a bloquear.

---

## 5. Riesgos y cómo mitigarlos

| Riesgo | Mitigación |
|--------|------------|
| Romper algo que hoy funciona durante la migración | Escribir tests de las funciones puras **antes** de moverlas (fase 1), y trabajar con fases cortas y mergeables. |
| Los marketplaces cambian su HTML y los selectores se rompen | Fixtures de HTML por adaptador, error `SELECTOR_CHANGED` con snapshot automático y alerta. Para Walmart, priorizar el JSON sobre el DOM. |
| MeLi bloquea sin proxies (ya pasa hoy) | La caché reduce las búsquedas, la rotación pasa a funcionar de verdad (A4) y el pool reutiliza sesiones. Hay que decidir si se invierte en proxies residenciales. |
| Términos de uso de los marketplaces | Uso interno, bajo volumen, con delays y caché. Evaluar la API oficial de MeLi: `auth.js` ya obtiene un token, pero hay que verificar si la app tiene habilitado el endpoint de búsqueda. |
| Sobre-ingeniería para un equipo chico | Cada pieza se agrega cuando hace falta: cola en memoria antes que pg-boss y Postgres como cola antes que Redis. No hay microservicios ni Kubernetes. |

---

## 6. Decisiones abiertas (a definir con el equipo)

1. **¿Dónde se va a desplegar y quién lo usa?** ¿Solo el equipo interno? ¿Cuántas personas? Esto define la autenticación y la infraestructura (VPS, Railway, Render, Fly…). Vercel sirve para la web, pero no para el worker.
2. **¿Hay presupuesto para proxies residenciales?** Es lo que más impacta en la tasa de éxito con MeLi. **Pasó a ser urgente:** desde 2026-11-06 MeLi bloquea la IP actual con un muro de login (ver los hallazgos de la fase 0).
3. **¿Los jobs de Excel van a la web (fase 5) o alcanza con dejarlos como CLI?** Si se usan seguido, conviene la web.
4. **¿Qué significa "Cliente nuevo / actual"?** ¿Es un metadato de la búsqueda, o tendría que cambiar algo del análisis?
5. **¿Hace falta seguimiento de precios en el tiempo** (re-scrapear un producto todos los días)? Si la respuesta es sí, el modelo de datos de la fase 3 ya lo deja preparado con jobs programados de pg-boss.

---

## 7. Orden recomendado

```
Fase 0 (ya) ──► Fase 1 ──► Fase 2 ──► Fase 3 ──┬──► Fase 4
                                               └──► Fase 5 ──► Fase 6
```

Las fases 4 y 5 se pueden hacer en paralelo una vez que exista la API con persistencia. La 6 se puede adelantar si hay que desplegar antes, pero **la autenticación (C4) es obligatoria antes de exponer la app a internet**.
