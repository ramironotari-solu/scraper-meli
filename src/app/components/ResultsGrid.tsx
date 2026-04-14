import type { Product } from '@/lib/types';
import ProductCard from './ProductCard';

export default function ResultsGrid({ products }: { products: Product[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800/80 overflow-hidden">
      {products.map((product, i) => (
        <ProductCard key={product.url ?? i} product={product} />
      ))}
    </div>
  );
}
