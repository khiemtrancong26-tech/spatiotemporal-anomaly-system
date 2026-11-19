# Màn hình nhập CSV và JSON

> Đây là luồng người dùng chọn file, xem lỗi, ghép cột rồi bấm Import. Khi backend xác nhận dataset đã nhập, giao diện cho mở workspace.

## Mở file nào

- Điều phối upload, validation, mapping, import và lưu key cho thao tác đang thực hiện. [`page.tsx`](page.tsx)
- Chuyển từng bước của giao diện thành request HTTP. [`../../shared/data-source/online.ts`](../../shared/data-source/online.ts)
- Xem phía backend ghi file, đọc theo luồng và import theo batch. [`../../../../server/src/modules/datasets/`](../../../../server/src/modules/datasets/README.md)
