# Bộ kiểm thử Vitest của backend

> Thư mục này chứa unit, contract và integration tests để kiểm tra từng phần và các luồng qua MongoDB hoặc Python thật.

## Mở file nào

- Kiểm tra logic, schema và HTTP inject. [`unit/`](unit/README.md)
- Kiểm tra các module với persistence hoặc tiến trình thật. [`integration/`](integration/README.md)
- Dữ liệu mẫu và các tiến trình hỗ trợ kiểm thử. [`fixtures/`](fixtures/README.md)
- Cung cấp cấu hình cách ly cho test. [`helpers.ts`](helpers.ts)
- Chuẩn bị đường dẫn và cấu hình model cho các ca tích hợp. [`engine-integration.helpers.ts`](engine-integration.helpers.ts)
