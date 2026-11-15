export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Độ lệch chuẩn tổng thể (population). */
export function std(xs: readonly number[], mu: number = mean(xs)): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += (x - mu) ** 2;
  return Math.sqrt(s / xs.length);
}

/** Percentile nội suy tuyến tính, p ∈ [0,1]. `sorted` phải tăng dần. */
export function quantileSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (pos - lo);
}

/** Độ lệch chuẩn mẫu (chia n-1) - không chệch khi cửa sổ nhỏ. */
export function sampleStd(xs: readonly number[], mu: number = mean(xs)): number {
  if (xs.length < 2) return NaN;
  let s = 0;
  for (const x of xs) s += (x - mu) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}
