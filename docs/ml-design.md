# Thiết kế ML - Phát hiện bất thường PM2.5

Người phụ trách thuật toán: Khải. Tích hợp Server: Khiêm. Liên quan: OPEN-03, OPEN-06, BR-09, BR-11.

## Đề xuất: Isolation Forest (D008, chờ nhóm xác nhận)

- **Không cần nhãn**: dữ liệu cảm biến thực tế thường chưa gán nhãn bất thường.
- **Nhẹ**: cây ngẫu nhiên, suy luận ngay trong Node, không cần Python runtime hay service riêng (D002).
- **Model là một file JSON** (~190 KB) nên dễ kiểm chứng `train → save → load → predict` (SDD mục ML).
- Hợp BR-11: huấn luyện ngoài request, Server chỉ suy luận. Không dùng LLM (D006).

SRS ghi Isolation Forest chỉ là ứng viên (OPEN-03). Tài liệu này là POC để nhóm quyết định, chưa phải quyết định cuối.

## Đặc trưng (6 chiều, `src/ml/features.ts`)

| Feature | Ý nghĩa |
|---|---|
| `value` | PM2.5 (µg/m³) |
| `delta_prev` | chênh lệch so với điểm trước của cùng sensor |
| `rolling_dev` | độ lệch (đơn vị std) so với 6 điểm trước |
| `hour_sin`, `hour_cos` | chu kỳ ngày (giờ UTC) |
| `spatial_dev` | lệch so với trung bình các sensor khác trong cùng giờ |

`spatial_dev` là phần "không gian": một sensor tăng đột biến trong khi các sensor khác không tăng đáng nghi hơn một đợt ô nhiễm cả thành phố. Detector thống kê hiện xét từng sensor độc lập nên không thấy tín hiệu này.

## Vòng đời model

1. `npm run train -w shared-core -- --csv data.csv --version 1.1.0` ghi `models/*.json` (CSV dạng `station_id,lat,lon,observed_at,pm25`).
2. Ngưỡng = phân vị `1 - contamination` của score trên tập huấn luyện (mặc định 0.01).
3. Server: `createMlAdapter(json)` kiểm tra schema và danh sách feature (sai thì ném lỗi, không cho kết quả sai), rồi `detect(readings)`.
4. `modelVersion` ghi vào `AnalysisRun.modelVersion`; `family = "ml"`, `method = "isolation_forest"`.

Model v1 (`models/pm25-iforest-v1.json`) **huấn luyện trên dữ liệu giả lập**; phải huấn luyện lại khi có dữ liệu thật.

## Đánh giá (dữ liệu giả lập có nhãn)

Huấn luyện 30 ngày × 8 sensor (seed 100); kiểm thử trung bình 5 bộ 14 ngày (seed 11-15); tỉ lệ bất thường thật 1% (75% đột biến tăng, 25% rơi đột ngột). Chạy lại: `npm run benchmark -w shared-core`.

| Phương pháp | Precision | Recall | F1 |
|---|---|---|---|
| Z-score (ngưỡng 3σ) | 1.000 | 0.870 | 0.929 |
| IQR (k=1.5) | 0.869 | 0.987 | 0.922 |
| Moving Average (w=12, 4σ) | 0.741 | 0.750 | 0.744 |
| Isolation Forest (ML) | 0.981 | 0.966 | 0.973 |

**Độ nhạy của Isolation Forest theo `contamination`** (tỉ lệ bất thường thật = 0.01):

| contamination | Precision | Recall | F1 |
|---|---|---|---|
| 0.005 | 1.000 | 0.551 | 0.705 |
| 0.01 | 0.981 | 0.966 | 0.973 |
| 0.015 | 0.806 | 1.000 | 0.891 |
| 0.02 | 0.562 | 1.000 | 0.718 |
| 0.03 | 0.385 | 1.000 | 0.553 |

### Giới hạn (cần đọc trước khi trích số liệu)

- Dữ liệu **giả lập** với đột biến lớn, dễ với Z-score/IQR. Kết quả **không** chứng minh hiệu quả trên dữ liệu thật, cần đánh giá lại khi có dataset PM2.5 thật (nguồn tọa độ phải xác minh, xem mục D của `shared-data-contract.md`).
- Isolation Forest rất nhạy với `contamination`: đặt đúng tỉ lệ thật cho F1 ≈ 0.97, đặt gấp đôi giảm còn ≈ 0.72. Tỉ lệ thật chưa biết nên đây là siêu tham số phải hiệu chỉnh.
- Isolation Forest không ngoại suy: score bão hoà khi giá trị vượt ngoài miền huấn luyện.
- Z-score toàn chuỗi dễ bị masking nếu một sensor có nhiều bất thường.
- Moving Average mặc định (window 12, 4σ) được chỉnh trên dữ liệu giả lập: với window 5 và 3σ precision chỉ ≈ 0.1 vì cửa sổ nhỏ ước lượng độ phân tán thấp.
- `hour_sin/cos` dùng giờ UTC; nếu muốn theo giờ địa phương (UTC+7) phải đổi cả huấn luyện lẫn suy luận.
- Chưa đo hiệu năng suy luận trên dataset lớn nên chưa có căn cứ cho OPEN-06 (đồng bộ hay Server Worker). Cần benchmark trước khi quyết định.

## Hướng mở rộng

- Đánh giá và hiệu chỉnh ngưỡng trên dữ liệu thật; cho analyst chỉnh `contamination`/ngưỡng.
- Thêm đặc trưng thời tiết nếu có; thử mô hình chuỗi nếu Isolation Forest không đủ.
- Đo thời gian suy luận theo số reading để quyết định OPEN-06.
