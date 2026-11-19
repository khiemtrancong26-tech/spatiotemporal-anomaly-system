# Đọc trạm và readings theo trang

> Module này phục vụ dữ liệu hiển thị. Frontend gửi dataset và bộ lọc, backend truy vấn MongoDB theo cursor.

## Mở file nào

- Khai báo `GET /api/v1/sensors` và `GET /api/v1/readings`. [`query.routes.ts`](query.routes.ts)
- Kiểm tra truy cập, bộ lọc và xây trang trả về. [`query.service.ts`](query.service.ts)
- Dùng projection, thứ tự ổn định và điều kiện keyset để đọc từ MongoDB. [`query.repository.ts`](query.repository.ts)
- Kiểm tra thời gian và vùng tọa độ. [`query.validation.ts`](query.validation.ts)

Readings mặc định trả 100 bản ghi mỗi trang. Analysis đọc phạm vi job qua module Analysis.
