import type { MarketStats } from '@/lib/types';

function formatPrice(price: number): string {
  return price.toLocaleString('es-AR');
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wide mb-0.5">
        {label}
      </p>
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{value}</p>
      {sub && <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">{sub}</p>}
    </div>
  );
}

interface Props {
  query: string;
  countryName: string;
  marketplaceName: string;
  marketplace: string;
  stats: MarketStats;
  summary: string | null;
  loadingSummary: boolean;
}

export default function MarketSummary({
  countryName, marketplaceName, marketplace, stats, summary, loadingSummary,
}: Props) {
  const pct = (n: number) => (stats.total ? Math.round((n / stats.total) * 100) : 0);
  const freeShippingPct = pct(stats.freeShippingCount);
  const discountPct = pct(stats.discountCount);
  const fullLabel = marketplace === 'walmart' ? '2-Day' : 'FULL';

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 p-5 mb-4">
      <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-600 uppercase tracking-widest mb-4">
        Resumen de mercado · {marketplaceName} · {countryName} · {stats.total} productos
      </p>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 mb-4">
        <StatCard
          label="Precio mínimo"
          value={stats.minPrice != null ? `$${formatPrice(stats.minPrice)}` : '—'}
        />
        <StatCard
          label="Precio máximo"
          value={stats.maxPrice != null ? `$${formatPrice(stats.maxPrice)}` : '—'}
        />
        <StatCard
          label="Con descuento"
          value={`${stats.discountCount} / ${stats.total}`}
          sub={`${discountPct}% · prom. ${stats.avgDiscount}% off`}
        />
        <StatCard
          label="Envío gratis"
          value={`${stats.freeShippingCount} (${freeShippingPct}%)`}
          sub={stats.fullCount > 0 ? `${stats.fullCount} con ${fullLabel}` : undefined}
        />
      </div>

      {/* Top sellers */}
      {stats.topSellers.length > 0 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
          <span className="text-zinc-400 dark:text-zinc-600">Top vendedores:</span>{' '}
          {stats.topSellers.join(' · ')}
        </p>
      )}

      {/* Divider */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 my-4" />

      {/* AI analysis */}
      <div className="flex gap-2.5 items-start">
        <span className="text-zinc-400 dark:text-zinc-600 flex-shrink-0 mt-0.5 text-sm leading-none select-none">
          ✦
        </span>
        {loadingSummary ? (
          <div className="flex items-center gap-2 text-sm text-zinc-400 dark:text-zinc-600">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-500 animate-spin inline-block flex-shrink-0" />
            Generando análisis de mercado...
          </div>
        ) : summary ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{summary}</p>
        ) : (
          <p className="text-xs text-zinc-400 dark:text-zinc-600 italic">
            Configurá{' '}
            <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded text-zinc-500">
              ANTHROPIC_API_KEY
            </code>{' '}
            para habilitar el análisis con IA.
          </p>
        )}
      </div>
    </div>
  );
}
