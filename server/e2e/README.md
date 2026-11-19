# Kiểm thử trình duyệt với backend thật

> Các suite ở đây chạy luồng Desktop qua frontend, Fastify và MongoDB thử nghiệm để kiểm tra tích hợp xuyên suốt.

## Mở file nào

- Kiểm tra upload, xác nhận mapping, import và đường lỗi. [`dataset-import.spec.ts`](dataset-import.spec.ts)
- Kiểm tra gửi Analysis, theo dõi và mở kết quả. [`statistical-analysis.spec.ts`](statistical-analysis.spec.ts)
- Kiểm tra luồng ML với model thật. [`isolation-forest.spec.ts`](isolation-forest.spec.ts)
- Kiểm tra review và xử lý xung đột. [`anomaly-review.spec.ts`](anomaly-review.spec.ts)
- Kiểm tra lưu và đồng bộ review khi kết nối trở lại. [`offline-review-sync.spec.ts`](offline-review-sync.spec.ts)
- Cấu hình Chromium Desktop cho nhóm test server. [`../playwright.config.ts`](../playwright.config.ts)
