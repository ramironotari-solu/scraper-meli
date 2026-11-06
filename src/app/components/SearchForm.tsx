'use client';

import { useState, useCallback, useMemo } from 'react';
import ExcelJS from 'exceljs';
import type { Product, MarketStats } from '@/lib/types';
import ResultsGrid from './ResultsGrid';
import MarketSummary from './MarketSummary';

const MARKETPLACES = {
  meli:      'MercadoLibre',
  walmart:   'Walmart',
  tiendamia: 'Tiendamia',
} as const;

type Marketplace = keyof typeof MARKETPLACES;

const MARKETPLACE_COUNTRIES: Record<Marketplace, Record<string, string>> = {
  meli: {
    AR: 'Argentina',
    MX: 'México',
    BR: 'Brasil',
    CO: 'Colombia',
    CL: 'Chile',
    UY: 'Uruguay',
  },
  walmart: {
    US: 'United States',
    MX: 'México',
  },
  tiendamia: {
    AR: 'Argentina',
  },
};

const DEFAULT_COUNTRY: Record<Marketplace, string> = {
  meli:      'AR',
  walmart:   'US',
  tiendamia: 'AR',
};

interface SearchResponse {
  products: Product[];
  page: number;
  hasMore: boolean;
  stats?: MarketStats;
  error?: string;
}

export default function SearchForm() {
  const [query, setQuery] = useState('');
  const [marketplace, setMarketplace] = useState<Marketplace>('meli');
  const [country, setCountry] = useState<string>('AR');
  const [clientType, setClientType] = useState<'nuevo' | 'actual'>('nuevo');
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [lastQuery, setLastQuery] = useState('');
  const [lastCountry, setLastCountry] = useState<string>('AR');
  const [lastMarketplace, setLastMarketplace] = useState<Marketplace>('meli');
  const [stats, setStats] = useState<MarketStats | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [sortBy, setSortBy] = useState<'default' | 'price_asc' | 'price_desc' | 'discount_desc' | 'rating_desc'>('default');
  const [hideAds, setHideAds] = useState(false);
  const [onlyDiscount, setOnlyDiscount] = useState(false);
  const [onlyFreeShipping, setOnlyFreeShipping] = useState(false);
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');

  const handleMarketplaceChange = (mp: Marketplace) => {
    setMarketplace(mp);
    setCountry(DEFAULT_COUNTRY[mp]);
    setResults([]);
    setSearched(false);
    setStats(null);
    setSummary(null);
    setError(null);
  };

  const fetchPage = useCallback(
    async (q: string, mp: Marketplace, c: string, p: number): Promise<SearchResponse> => {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, marketplace: mp, country: c, page: p }),
      });
      const data: SearchResponse = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error en el servidor');
      return data;
    },
    [],
  );

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || loading) return;

    setLoading(true);
    setError(null);
    setResults([]);
    setSearched(false);
    setHasMore(false);
    setStats(null);
    setSummary(null);
    setLoadingSummary(false);
    setSortBy('default');
    setHideAds(false);
    setOnlyDiscount(false);
    setOnlyFreeShipping(false);
    setPriceMin('');
    setPriceMax('');

    try {
      const data = await fetchPage(q, marketplace, country, 1);
      setResults(data.products);
      setHasMore(data.hasMore);
      setPage(1);
      setSearched(true);
      setLastQuery(q);
      setLastCountry(country);
      setLastMarketplace(marketplace);

      if (data.stats) {
        setStats(data.stats);
        setLoadingSummary(true);
        fetch('/api/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, marketplace, country, stats: data.stats }),
        })
          .then(r => r.json())
          .then(d => setSummary(d.summary ?? null))
          .catch(() => setSummary(null))
          .finally(() => setLoadingSummary(false));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    setError(null);
    const nextPage = page + 1;
    try {
      const data = await fetchPage(lastQuery, lastMarketplace, lastCountry, nextPage);
      setResults(prev => [...prev, ...data.products]);
      setHasMore(data.hasMore);
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoadingMore(false);
    }
  };

  const displayedProducts = useMemo(() => {
    let out = results;
    if (hideAds) out = out.filter(p => !p.isAd);
    if (onlyDiscount) out = out.filter(p => (p.discountPct ?? 0) > 0);
    if (onlyFreeShipping) out = out.filter(p => p.hasFreeShipping);
    const min = priceMin !== '' ? Number(priceMin) : null;
    const max = priceMax !== '' ? Number(priceMax) : null;
    if (min !== null && !isNaN(min)) out = out.filter(p => p.price !== null && p.price >= min);
    if (max !== null && !isNaN(max)) out = out.filter(p => p.price !== null && p.price <= max);
    const arr = [...out];
    if (sortBy === 'price_asc') arr.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    else if (sortBy === 'price_desc') arr.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
    else if (sortBy === 'discount_desc') arr.sort((a, b) => (b.discountPct ?? 0) - (a.discountPct ?? 0));
    else if (sortBy === 'rating_desc') arr.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    return arr;
  }, [results, hideAds, onlyDiscount, onlyFreeShipping, priceMin, priceMax, sortBy]);

  const handleExport = async () => {
    if (displayedProducts.length === 0) return;
    const rows = lastMarketplace === 'walmart'
      ? displayedProducts.map(p => ({
          Título: p.title ?? '',
          Precio: p.price ?? '',
          'Precio original': p.originalPrice ?? '',
          'Descuento %': p.discountPct ?? '',
          Calificación: p.rating ?? '',
          Reseñas: p.reviewCount ?? '',
          Vendedor: p.seller ?? '',
          Envío: p.shippingText ?? '',
          Publicidad: p.isAd ? 'Sí' : 'No',
          URL: p.url ?? '',
        }))
      : displayedProducts.map(p => ({
          Título: p.title ?? '',
          Precio: p.price ?? '',
          'Precio original': p.originalPrice ?? '',
          'Descuento %': p.discountPct ?? '',
          Calificación: p.rating ?? '',
          Reseñas: p.reviewCount ?? '',
          Vendedor: p.seller ?? '',
          'Envío FULL': p.hasFull ? 'Sí' : 'No',
          'Envío gratis': p.hasFreeShipping ? 'Sí' : 'No',
          Publicidad: p.isAd ? 'Sí' : 'No',
          URL: p.url ?? '',
        }));
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Resultados');
    if (rows.length > 0) {
      worksheet.columns = Object.keys(rows[0]).map(key => ({ header: key, key, width: Math.max(key.length + 2, 15) }));
      rows.forEach(row => worksheet.addRow(row));
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = lastQuery.toLowerCase().replace(/\s+/g, '_');
    a.href = url;
    a.download = `${lastCountry}_${slug}_${clientType}_${lastMarketplace}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const currentCountries = MARKETPLACE_COUNTRIES[marketplace];
  const marketplaceName = MARKETPLACES[lastMarketplace];
  const countryName = MARKETPLACE_COUNTRIES[lastMarketplace][lastCountry] ?? lastCountry;

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <h1 className="text-xl font-semibold">Market Scraper</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            Investigación de mercado en {MARKETPLACES[marketplace]}
          </p>
        </div>
      </header>

      {/* Sticky search bar */}
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="zapatillas nike, celular samsung..."
              className="flex-1 h-10 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600"
            />
            <select
              value={marketplace}
              onChange={e => handleMarketplaceChange(e.target.value as Marketplace)}
              className="h-10 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600"
            >
              {(Object.entries(MARKETPLACES) as [Marketplace, string][]).map(([key, name]) => (
                <option key={key} value={key}>{name}</option>
              ))}
            </select>
            {Object.keys(currentCountries).length > 1 && (
              <select
                value={country}
                onChange={e => setCountry(e.target.value)}
                className="h-10 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600"
              >
                {Object.entries(currentCountries).map(([code, name]) => (
                  <option key={code} value={code}>{code} — {name}</option>
                ))}
              </select>
            )}
            <select
              value={clientType}
              onChange={e => setClientType(e.target.value as 'nuevo' | 'actual')}
              className="h-10 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600"
            >
              <option value="nuevo">Cliente nuevo</option>
              <option value="actual">Cliente actual</option>
            </select>
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="h-10 px-5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Buscando...' : 'Buscar'}
            </button>
          </form>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-32 gap-3">
            <div className="w-6 h-6 rounded-full border-2 border-zinc-200 dark:border-zinc-800 border-t-zinc-700 dark:border-t-zinc-300 animate-spin" />
            <p className="text-sm text-zinc-400 dark:text-zinc-600">
              Scrapeando {MARKETPLACES[marketplace]}... puede tomar unos segundos
            </p>
          </div>
        )}

        {/* Results */}
        {!loading && searched && (
          <>
            {stats && (
              <MarketSummary
                query={lastQuery}
                countryName={countryName}
                marketplaceName={marketplaceName}
                marketplace={lastMarketplace}
                stats={stats}
                summary={summary}
                loadingSummary={loadingSummary}
              />
            )}

            {results.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-zinc-100 dark:border-zinc-800">
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as typeof sortBy)}
                  className="h-8 px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600"
                >
                  <option value="default">Orden original</option>
                  <option value="price_asc">Precio ↑</option>
                  <option value="price_desc">Precio ↓</option>
                  <option value="discount_desc">Mayor descuento</option>
                  {lastMarketplace !== 'tiendamia' && <option value="rating_desc">Mejor rating</option>}
                </select>
                <button
                  onClick={() => setHideAds(v => !v)}
                  className={`h-8 px-3 rounded-lg border text-xs transition-colors ${hideAds ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}
                >
                  Sin anuncios
                </button>
                <button
                  onClick={() => setOnlyDiscount(v => !v)}
                  className={`h-8 px-3 rounded-lg border text-xs transition-colors ${onlyDiscount ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}
                >
                  Con descuento
                </button>
                <button
                  onClick={() => setOnlyFreeShipping(v => !v)}
                  className={`h-8 px-3 rounded-lg border text-xs transition-colors ${onlyFreeShipping ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}
                >
                  Envío gratis
                </button>
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-xs text-zinc-400 dark:text-zinc-600">Precio:</span>
                  <input
                    type="number"
                    placeholder="Mín"
                    value={priceMin}
                    onChange={e => setPriceMin(e.target.value)}
                    className="w-24 h-8 px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600"
                  />
                  <span className="text-xs text-zinc-300 dark:text-zinc-700">–</span>
                  <input
                    type="number"
                    placeholder="Máx"
                    value={priceMax}
                    onChange={e => setPriceMax(e.target.value)}
                    className="w-24 h-8 px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-zinc-400 dark:text-zinc-600">
                {displayedProducts.length === results.length
                  ? `${results.length} productos · página ${page}`
                  : `${displayedProducts.length} de ${results.length} productos · página ${page}`}
              </p>
              <button
                onClick={handleExport}
                className="h-7 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-500 dark:text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
              >
                ↓ Exportar XLSX
              </button>
            </div>

            <ResultsGrid products={displayedProducts} marketplace={lastMarketplace} />

            {hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="h-9 px-8 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm text-zinc-500 dark:text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {loadingMore ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-zinc-300 border-t-zinc-600 animate-spin inline-block" />
                      Cargando...
                    </span>
                  ) : (
                    'Cargar más'
                  )}
                </button>
              </div>
            )}
          </>
        )}

        {/* Initial state */}
        {!loading && !searched && !error && (
          <div className="flex flex-col items-center justify-center py-32 gap-2 text-zinc-300 dark:text-zinc-700">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <p className="text-sm">Ingresá un término de búsqueda para comenzar</p>
          </div>
        )}
      </main>
    </div>
  );
}
