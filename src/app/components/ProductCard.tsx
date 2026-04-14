import type { Product } from '@/lib/types';

function formatPrice(price: number): string {
  return price.toLocaleString('es-AR');
}

export default function ProductCard({ product }: { product: Product }) {
  const {
    title, url, price, originalPrice, discountPct,
    rating, seller, hasFull, hasFreeShipping, isAd, thumbnail,
  } = product;

  return (
    <a
      href={url ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/60 transition-colors"
    >
      {/* Thumbnail */}
      <div className="w-11 h-11 flex-shrink-0 rounded-md bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={title ?? 'Producto'}
            className="w-full h-full object-contain p-1.5"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-300 dark:text-zinc-700 text-xs select-none">
            ?
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Title + price */}
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm text-zinc-800 dark:text-zinc-200 truncate leading-snug">
            {title ?? '—'}
          </p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {originalPrice != null && originalPrice > (price ?? 0) && (
              <span className="text-xs text-zinc-400 dark:text-zinc-600 line-through hidden sm:inline">
                ${formatPrice(originalPrice)}
              </span>
            )}
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
              {price != null ? `$${formatPrice(price)}` : '—'}
            </span>
            {discountPct != null && (
              <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                -{discountPct}%
              </span>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {seller && (
            <span className="text-xs text-zinc-400 dark:text-zinc-600 truncate max-w-[200px]">
              {seller}
            </span>
          )}
          {rating != null && (
            <span className="text-xs text-zinc-400 dark:text-zinc-600 flex items-center gap-0.5 flex-shrink-0">
              <span className="text-amber-400">★</span>
              {rating.toFixed(1)}
            </span>
          )}
          {hasFull && (
            <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 flex-shrink-0">
              FULL
            </span>
          )}
          {hasFreeShipping && !hasFull && (
            <span className="text-[10px] text-zinc-400 dark:text-zinc-600 flex-shrink-0">
              Envío gratis
            </span>
          )}
          {isAd && (
            <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 flex-shrink-0">
              AD
            </span>
          )}
        </div>
      </div>
    </a>
  );
}
