# Màn hình chạy phân tích

> Người dùng chọn phương pháp, trạm và thời gian. Frontend gửi yêu cầu tạo run, theo dõi trạng thái rồi lấy kết quả đã công bố.

## Mở file nào

- Hiển thị phạm vi, số readings từ Profile và nút chạy. [`page.tsx`](page.tsx)
- Giữ payload và idempotency key để gửi lại cùng thao tác khi mất phản hồi. [`intent.ts`](intent.ts)
- Điều phối việc hỏi trạng thái run định kỳ. [`follow-run.ts`](follow-run.ts)
- Tải danh sách anomalies theo cursor khi run đã hoàn tất. [`results.tsx`](results.tsx)

Backend lấy readings theo phạm vi của run từ MongoDB. Số trang người dùng đã xem không quyết định đầu vào detector.
