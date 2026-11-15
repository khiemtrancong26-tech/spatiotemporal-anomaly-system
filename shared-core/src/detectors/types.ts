/** Phương pháp thống kê - khớp `StatisticalMethodSchema` trong contracts. */
export type DetectorMethod = 'zscore' | 'iqr' | 'moving_avg';

/** Lý do một điểm không được đánh giá / không có điểm số có ý nghĩa. */
export type SkipReason = 'insufficient_history' | 'zero_variance';

export interface PointResult {
  index: number;
  value: number;
  /** Độ lớn bất thường (≥ 0, hữu hạn). Thang đo phụ thuộc method. */
  score: number;
  /** false nếu điểm chưa đủ dữ liệu để đánh giá (khởi động cửa sổ, chuỗi quá ngắn). */
  evaluated: boolean;
  isAnomaly: boolean;
  reason?: SkipReason;
}

export interface SeriesResult {
  method: DetectorMethod;
  points: PointResult[];
  /** Thống kê/tham số đã dùng, phục vụ debug và hiển thị. */
  meta: Record<string, number>;
}
