# Thống kê khám phá theo phạm vi

> Module này tính Profile và dữ liệu tổng hợp theo trạm, giờ hoặc ngày để frontend hiểu dataset và vẽ biểu đồ.

## Mở file nào

- Khai báo API Profile và reading-aggregates. [`exploration.routes.ts`](exploration.routes.ts)
- Kiểm tra phạm vi, quyền dataset và giới hạn request đồng thời. [`exploration.service.ts`](exploration.service.ts)
- Gom dữ liệu theo thời gian trong MongoDB. [`exploration.repository.ts`](exploration.repository.ts)
- Quản lý metadata như múi giờ và chu kỳ lấy mẫu. [`exploration.metadata.ts`](exploration.metadata.ts)

Profile và aggregates dùng chung hai slot xử lý mặc định trên mỗi instance.
