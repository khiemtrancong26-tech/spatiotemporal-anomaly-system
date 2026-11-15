export interface Metrics {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

/** So khớp tập `readingId` được gắn cờ với ground truth. */
export function evaluate(flaggedReadingIds: Iterable<string>, truth: ReadonlySet<string>): Metrics {
  const pred = new Set(flaggedReadingIds);
  let tp = 0;
  for (const id of pred) if (truth.has(id)) tp++;
  const fp = pred.size - tp;
  const fn = truth.size - tp;
  const precision = pred.size ? tp / pred.size : 0;
  const recall = truth.size ? tp / truth.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { truePositives: tp, falsePositives: fp, falseNegatives: fn, precision, recall, f1 };
}

/** Lấy `readingId` bị gắn cờ từ kết quả detector (thống kê hoặc ML). */
export function flaggedIds(results: readonly { readingId: string; flagged: boolean }[]): string[] {
  return results.filter((r) => r.flagged).map((r) => r.readingId);
}
