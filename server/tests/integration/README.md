# Integration tests của backend

> Nhóm này kiểm tra các thành phần phối hợp với nhau, ví dụ Fastify đọc ghi MongoDB thật hoặc Node.js gọi Python thật.

## Mở file nào

- Kiểm tra import qua batch, replay và phục hồi. [`dataset-import.integration.test.ts`](dataset-import.integration.test.ts)
- Kiểm tra tiếp nhận job, lease và công bố kết quả. [`analysis-runs.integration.test.ts`](analysis-runs.integration.test.ts)
- Kiểm tra pipeline ML và dữ liệu ngữ cảnh. [`isolation-forest-runs.integration.test.ts`](isolation-forest-runs.integration.test.ts)
- Kiểm tra quyền hiển thị và xung đột review. [`anomaly-visibility-and-review.integration.test.ts`](anomaly-visibility-and-review.integration.test.ts)
- Kiểm tra kết nối, index và truy vấn trên MongoDB. [`mongodb.integration.test.ts`](mongodb.integration.test.ts)

Chạy từ thư mục gốc bằng `npm run test:integration --workspace @pm25/server`.
