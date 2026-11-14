
# Shared Core

Package dùng chung cho Client và Server.

- Người phụ trách: Khải.
- TypeScript Types và Zod Schemas.
- Thuật toán thống kê: Z-score, IQR, Moving Average.

Không phụ thuộc Fastify, MongoDB hoặc Browser DOM.

Trạng thái: Chưa khởi tạo package.


## D008 — Contract Analysis mục tiêu

[Shared Contract](../docs/shared-data-contract.md) và OpenAPI v0.3.0-draft đã thêm queued, scope và lỗi terminal cho Analysis async. `src/contracts/schemas.ts` đã migrate ngày 14/11/2026: scope, queued, terminal/error invariants và tests đối chiếu wire schema qua suite client. Package khai báo Zod trực tiếp; không triển khai engine. IQR nhận multiplier cố định 1.5 theo D009. Không triển khai engine/model hoặc thay severity; cấu hình IQR cố định theo D009, nghiệp vụ offline giữ nguyên.
