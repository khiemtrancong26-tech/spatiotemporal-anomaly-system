# Dataset, upload và import

> Module này quản lý danh sách dataset và toàn bộ luồng từ nhận CSV/JSON đến ghi readings vào MongoDB.

## Mở file nào

- Nhận upload multipart, validation, mapping và lệnh import. [`import.routes.ts`](import.routes.ts)
- Ghi file nguồn xuống đĩa dưới dạng stream và kiểm checksum. [`source-files.ts`](source-files.ts)
- Đọc record CSV/JSON theo luồng. [`source-parser.ts`](source-parser.ts)
- Kiểm tra nguồn, điều phối scan và xử lý từng batch nhập. [`import.service.ts`](import.service.ts)
- Ghi batch và công bố dataset sau khi nhập xong. [`import.repository.ts`](import.repository.ts)
- Lọc quyền sở hữu khi truy cập dataset. [`dataset-access.ts`](dataset-access.ts)

Upload và import là request riêng. API đọc sử dụng dữ liệu đã được công bố ở trạng thái `imported`.
