# Hàng đợi và vòng đời Analysis

> Backend nhận lệnh phân tích, lưu job bền vững vào MongoDB rồi trả HTTP 202. Worker lấy job để đọc dữ liệu, chạy detector và lưu kết quả.

## Mở file nào

- Khai báo tạo run, đọc trạng thái và lịch sử. [`analysis.routes.ts`](analysis.routes.ts)
- Kiểm tra quyền dataset, phạm vi, idempotency key và trạng thái sẵn sàng của ML. [`analysis.service.ts`](analysis.service.ts)
- Lưu queue, nhận job theo lease, truy vấn readings và cập nhật trạng thái. [`analysis.repository.ts`](analysis.repository.ts)
- Điều phối từ queued/running đến completed hoặc failed và ghi kết quả theo batch. [`analysis.worker.ts`](analysis.worker.ts)
- Đọc ngữ cảnh lịch sử và trạm lân cận cho ML. [`analysis.context.repository.ts`](analysis.context.repository.ts)

Mỗi instance mặc định xử lý một job cùng lúc. Giới hạn 50.000 áp dụng cho readings mục tiêu trong phạm vi của một run.
