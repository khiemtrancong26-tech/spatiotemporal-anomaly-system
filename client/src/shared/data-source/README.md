# Nguồn dữ liệu theo nghiệp vụ

> Màn hình gọi những phương thức như đọc readings, nhập dataset hoặc tạo Analysis run qua một interface chung.

## Mở file nào

- Định nghĩa các phương thức và kiểu tham số cho các nhóm nghiệp vụ. [`types.ts`](types.ts)
- Ánh xạ phương thức sang operation HTTP và chuẩn hóa query. [`online.ts`](online.ts)
- Lớp offline bổ sung cache và đồng bộ trên cùng ranh giới dữ liệu. [`../../offline/`](../../offline/README.md)
