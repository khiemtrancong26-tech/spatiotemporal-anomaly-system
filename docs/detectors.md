# Detector Contract & Hành vi

Chủ trì: Khải. Phối hợp: Khiêm (Backend), Duy (Web Worker).
Kiểu dữ liệu: `StatisticalDetectorInput/Output` trong `shared-core/src/contracts/schemas.ts` (không đổi).
Hàm: `runStatisticalDetector(input)` trong `shared-core/src/detectors/run.ts`.

## Quy ước

- **Deterministic**, cùng đầu vào cho cùng đầu ra. Server và Web Worker dùng đúng một hàm.
- Đầu vào không cần sắp xếp: detector nhóm theo `sensorId`, sắp theo `ts` rồi mới tính.
- Đầu ra có **một kết quả cho mỗi reading**, đúng thứ tự đầu vào. Backend chỉ lưu `flagged = true` thành Anomaly.
- `score` luôn hữu hạn, ≥ 0. **Thang đo phụ thuộc method**, không so sánh giữa các method.
- Offline, Web Worker chỉ cho kết quả cục bộ (không có ID Server).

## Method

| `method` | Ý nghĩa | `config.threshold` | `config.windowSize` | `score` |
|---|---|---|---|---|
| `zscore` | Z-score trên toàn chuỗi một sensor (std tổng thể) | ngưỡng \|z\| | không dùng | \|z\| |
| `iqr` | Hàng rào Tukey Q1 − k·IQR, Q3 + k·IQR | hệ số k | không dùng | số IQR vượt hàng rào (0 nếu trong hàng rào) |
| `moving_avg` | So với trung bình/std mẫu của `windowSize` điểm **đứng trước** (không gồm chính nó) | ngưỡng \|z\| | số điểm lịch sử | \|z\| so với cửa sổ |

Cờ khi `score > threshold` (zscore, moving_avg) hoặc vượt hàng rào (iqr).

### Cấu hình mặc định ĐỀ XUẤT (OPEN-04, chưa được duyệt)

`zscore: 3`, `iqr: 1.5`, `moving_avg: threshold 4, windowSize 12` (xuất ở `DEFAULT_DETECTOR_CONFIG`).
Moving Average dùng thêm sàn độ lệch chuẩn nội bộ 3 µg/m³ (không nằm trong `config` vì contract là `strict`).
Các giá trị này được chỉnh trên dữ liệu giả lập, **cần hiệu chỉnh lại trên dữ liệu PM2.5 thật**.

## `status` và `reason`

| `status` | Khi nào |
|---|---|
| `completed` | ít nhất một reading được đánh giá |
| `insufficient_data` | không sensor nào đủ điểm: zscore < 3, iqr < 4, moving_avg ≤ `windowSize` điểm mỗi sensor, hoặc không có reading. Không tạo anomaly giả |
| `invalid_input` | sai schema, `threshold ≤ 0`, `readingId` trùng. `results` rỗng, `message` nêu lý do. Nếu `method` không hợp lệ thì `method` trả về là `zscore` |

`reason` (tuỳ chọn, từng điểm): `insufficient_history` (chuỗi ngắn hoặc đang khởi động cửa sổ), `zero_variance` (phương sai bằng 0, score 0).

## Severity (đề xuất OPEN-04)

`proposeSeverity(family, score)`: thống kê `≥5 high`, `≥3 medium`, còn lại `low`; ML `≥0.7 high`, `≥0.6 medium`, còn lại `low`.
Vì cờ zscore/moving_avg chỉ bật khi score > 3 hoặc > 4, hai method này không bao giờ cho `low`.

## Đề xuất bổ sung cho hợp đồng (cần Khiêm review, chưa đổi `schemas.ts`)

1. `AnalysisRun.method` cho ML = `isolation_forest`; `family = "ml"`; `modelVersion` lấy từ `MlInferenceAdapter.modelVersion`; `engineVersion` lấy từ `ENGINE_VERSION`.
2. Đầu ra ML là `MlDetectorOutput` (cùng dạng `results[{readingId, score, flagged}]`, `status`, thêm `modelVersion`), vì `StatisticalDetectorOutputSchema` chỉ chấp nhận method thống kê.
3. `buildAnomalyDrafts(...)` dựng Anomaly còn thiếu `id`, `analysisRunId`, `updatedAt`; mặc định `status: open`, `version: 1`, `note: ""`.
4. Khoá `config` của `StatisticalDetectorInputSchema` là `strict`; muốn thêm tham số (ví dụ sàn std) phải đổi schema.
