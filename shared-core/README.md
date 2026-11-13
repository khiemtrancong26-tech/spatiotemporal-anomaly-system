
# Shared Core

Package dùng chung cho Client và Server.

- Người phụ trách: Khải.
- TypeScript Types và Zod Schemas.
- Thuật toán thống kê: Z-score, IQR, Moving Average.

Không phụ thuộc Fastify, MongoDB hoặc Browser DOM.

Trạng thái: Chưa khởi tạo package.


## D008 — Contract Analysis mục tiêu

[Shared Contract](../docs/shared-data-contract.md) và OpenAPI v0.3.0-draft đã thêm queued, scope và lỗi terminal cho Analysis async. `src/contracts/schemas.ts` chưa được migrate trong đợt chỉ sửa tài liệu; cần cập nhật Zod/types và test trước B5/M5. Không đổi detector model/config/severity hoặc offline statistics trong đợt này.
