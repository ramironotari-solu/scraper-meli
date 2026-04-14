'use client';

import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import type { Product, MarketStats } from '@/lib/types';
import ResultsGrid from './ResultsGrid';
import MarketSummary from './MarketSummary';

const COUNTRIES = {
  AR: 'Argentina',
  MX: 'México',
  BR: 'Brasil',
  CO: 'Colombia',
  CL: 'Chile',
  UY: 'Uruguay',
} as const;

type CountryCode = keyof typeof COUNTRIES;

interface SearchResponse {
  products: Product[];
  page: number;
  hasMore: boolean;
  stats?: MarketStats;
  error?: string;
}

export default function SearchForm() {
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState<CountryCode>('AR');
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [lastQuery, setLastQuery] = useState('');
  const [lastCountry, setLastCountry] = useState<CountryCode>('AR');
  const [stats, setStats] = useState<MarketStats | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const fetchPage = useCallback(
    async (q: string, c: CountryCode, p: number): Promise<SearchResponse> => {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, country: c, page: p }),
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

    try {
      const data = await fetchPage(q, country, 1);
      setResults(data.products);
      setHasMore(data.hasMore);
      setPage(1);
      setSearched(true);
      setLastQuery(q);
      setLastCountry(country);

      if (data.stats) {
        setStats(data.stats);
        // Fire off AI summary non-blocking — products show immediately
        setLoadingSummary(true);
        fetch('/api/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, country, stats: data.stats }),
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
      const data = await fetchPage(lastQuery, lastCountry, nextPage);
      setResults(prev => [...prev, ...data.products]);
      setHasMore(data.hasMore);
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleExport = () => {
    if (results.length === 0) return;
    const rows = results.map(p => ({
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
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
    const slug = lastQuery.toLowerCase().replace(/\s+/g, '_');
    XLSX.writeFile(wb, `${lastCountry}_${slug}_meli.xlsx`);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <h1 className="text-xl font-semibold">MeLi Scraper</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            Investigación de mercado en Mercado Libre
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
              value={country}
              onChange={e => setCountry(e.target.value as CountryCode)}
              className="h-10 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600"
            >
              {(Object.entries(COUNTRIES) as [CountryCode, string][]).map(([code, name]) => (
                <option key={code} value={code}>{code} — {name}</option>
              ))}
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
              Scrapeando Mercado Libre... puede tomar unos segundos
            </p>
          </div>
        )}

        {/* Results */}
        {!loading && searched && (
          <>
            {/* Market summary card */}
            {stats && (
              <MarketSummary
                query={lastQuery}
                countryName={COUNTRIES[lastCountry]}
                stats={stats}
                summary={summary}
                loadingSummary={loadingSummary}
              />
            )}

            {/* List header */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-zinc-400 dark:text-zinc-600">
                {results.length} productos · página {page}
              </p>
              <button
                onClick={handleExport}
                className="h-7 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-500 dark:text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
              >
                ↓ Exportar XLSX
              </button>
            </div>

            {/* Product list */}
            <ResultsGrid products={results} />

            {/* Load more */}
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
