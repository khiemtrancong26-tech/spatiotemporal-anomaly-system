# Các đường dẫn của frontend

> Thư mục này nối URL với màn hình React bằng TanStack Router và kiểm tra điều kiện truy cập khi chuyển trang.

## Mở file nào

- Khai báo tuyến gốc và khung dùng chung. [`__root.tsx`](__root.tsx)
- Nối URL đăng nhập. [`login.tsx`](login.tsx)
- Nối URL nhập dataset với wizard. [`datasets.import.tsx`](datasets.import.tsx)
- Đọc dataset ID từ URL và mở workspace đúng dataset. [`workspace.$datasetId.tsx`](workspace.$datasetId.tsx)
- Cây route được sinh từ các file route. [`../routeTree.gen.ts`](../routeTree.gen.ts)
