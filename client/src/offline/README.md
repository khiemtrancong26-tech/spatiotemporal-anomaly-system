# Lưu dữ liệu và review khi mất mạng

> Frontend lưu dữ liệu đã tải để mở lại khi mất mạng. Review cần gửi sau được ghi vào hàng chờ bền vững của trình duyệt.

## Mở file nào

- Tạo IndexedDB và lưu cache, metadata cùng các thay đổi chờ gửi. [`storage.ts`](storage.ts)
- Chọn dữ liệu online hoặc bản đã lưu theo khả năng kết nối. [`data.ts`](data.ts)
- Khôi phục ngữ cảnh, đồng bộ review và xử lý các kết quả như trùng hoặc xung đột. [`services.ts`](services.ts)

Chấm điểm ML mới cần backend online. Các thao tác offline phục vụ dữ liệu đã tải và phần review được hỗ trợ.
