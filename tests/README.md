
# Testing

- Người điều phối: Cường.
- Unit và Integration Tests: Vitest.
- E2E: Playwright.
- Kiểm thử tải backend: k6.
- Coverage và báo cáo kiểm thử.

Mỗi thành viên tự viết test cho module của mình.

## Vị trí test backend

- [`server/tests/unit/`](../server/tests/unit/) chứa `*.test.ts` cho unit và contract.
- [`server/tests/integration/`](../server/tests/integration/) chứa `*.integration.test.ts` cho luồng dùng MongoDB hoặc tiến trình thật.
- [`server/e2e/`](../server/e2e/) chứa `*.spec.ts` cho luồng trình duyệt.

Tên file theo nghiệp vụ được kiểm tra, ví dụ `dataset-import.integration.test.ts` và `statistical-analysis.spec.ts`. Lệnh chạy được ghi trong [server README](../server/README.md#kiểm-thử).

## Vị trí test frontend

- [`client/tests/unit/`](../client/tests/unit/) chứa unit và contract checks.
- [`client/tests/integration/`](../client/tests/integration/) chứa test phối hợp component, router, state và HTTP adapter.
- [`client/e2e/`](../client/e2e/) chứa test Playwright trong trình duyệt với chế độ mock hoặc API được mô phỏng.

Ví dụ tên suite theo chức năng gồm `analysis-run-polling.test.ts`, `email-auth-routes.integration.test.tsx` và `space-time-cube.spec.ts`. Xem [lệnh chạy test client](../client/README.md#lệnh-kiểm-tra).

## Kiểm thử tải backend

Bài k6 ngày 18/11/2026 dùng Fastify thật và MongoDB replica set tạm. Tập API đọc đạt mục tiêu SRS ở **100 VU trong 10 phút**, với **310.242 request**, **p95 tổng 330 ms** và **0 lỗi đọc**. Tải upload/import, Analysis và review có phép đo trước/sau trong kịch bản hỗn hợp.

Kịch bản nằm tại [performance.k6.js](../server/scripts/performance.k6.js) và được chạy bằng [benchmark-performance.mjs](../server/scripts/benchmark-performance.mjs). Profile đã đo và cách tái lập nằm trong [báo cáo backend](../docs/backend/performance-audit.md#chạy-lại).

