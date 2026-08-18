/** Probability (0–1) → decimal odds and American. */

export interface PriceQuoteFmt {
  price: number;
  cents: number;
  decimal: number;
  american: number;
  americanLabel: string;
  decimalLabel: string;
  compact: string;
}

export function decimalFromPrice(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return 0;
  return Math.round((1 / p) * 100) / 100;
}

export function americanFromPrice(p: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return 0;
  if (p >= 0.5) return -Math.round((p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

export function americanLabel(n: number): string {
  if (!n) return "—";
  return n > 0 ? `+${n}` : String(n);
}

export function formatPriceQuote(p: number): PriceQuoteFmt {
  const price = Number.isFinite(p) ? p : 0;
  const american = americanFromPrice(price);
  const decimal = decimalFromPrice(price);
  const cents = Math.round(price * 1000) / 10;
  return {
    price,
    cents,
    decimal,
    american,
    americanLabel: americanLabel(american),
    decimalLabel: decimal > 0 ? decimal.toFixed(2) : "—",
    compact: price > 0
      ? `${price.toFixed(3)} · ${decimal.toFixed(2)} · ${americanLabel(american)}`
      : "—",
  };
}
