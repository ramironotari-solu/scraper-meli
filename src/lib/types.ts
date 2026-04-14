export type MarketStats = {
  total: number;
  minPrice: number | null;
  maxPrice: number | null;
  avgPrice: number | null;
  discountCount: number;
  avgDiscount: number;
  topSellers: string[];
  freeShippingCount: number;
  fullCount: number;
  adCount: number;
  avgRating: number | null;
};

export type Product = {
  title: string | null;
  url: string | null;
  price: number | null;
  originalPrice: number | null;
  discountPct: number | null;
  rating: number | null;
  reviewCount: number | null;
  seller: string | null;
  hasFull: boolean;
  hasFreeShipping: boolean;
  isAd: boolean;
  thumbnail: string | null;
};
