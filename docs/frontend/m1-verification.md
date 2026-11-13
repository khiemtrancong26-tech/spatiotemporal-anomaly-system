# M1 — Kết quả triển khai nền tảng frontend

Ngày: 13/11/2026. Phạm vi: M1 của [kế hoạch](../frontend-online-plan.md), không bao gồm nghiệp vụ M2–M7 hoặc PWA/Offline/Sync.

## Đã triển khai

- Package `@pm25/client` trong npm workspaces, lockfile root, React 19.3.1, Vite 8.3.8, TypeScript 5.9.3; TanStack file-based routes, Zustand store chỉ giữ vai trò xem thử trong RAM.
- Shell responsive, navigation theo role **trong bản mock**, not-found/error boundary; routes login, datasets, import, workspace theo ID và admin là placeholders. Xác thực/route guard thật thuộc M2.
- Primitives Button/Badge/Field/PageTitle/Loading/Empty/Error/CursorLoadMore, panel kiểm tra health; font system, màu/spacing theo M0, timezone label UTC+07.
- Interface online, adapter đủ 18 operations, HTTP client validate request/response theo OpenAPI. M0 DTO snapshot không được dùng làm nguồn chuẩn runtime.
- JSON/multipart, Bearer getter, idempotency key bắt buộc theo operation, lỗi phân loại, AbortSignal; không tự fallback mock hoặc retry mutation.
- Cursor controller reset theo scope, hủy/bỏ response trễ, giữ hàng đã tải khi lỗi load-more, retry đúng cursor, deduplicate ID.
- Helper mutation tạo key theo ý định và snapshot payload; cùng object retry dùng lại key, double submit đang pending dùng chung Promise.
- Mock fetch đọc fixtures M0, delay/cancellation/scenario/role/filter/pagination; không có service worker/cache/outbox. Build online mặc định loại chunk transport mock.

## Kiểm tra và bằng chứng

| Kiểm tra | Kết quả |
|---|---|
| Sinh contract | 18 operations + 30 schemas từ OpenAPI, types bằng openapi-typescript |
| Typecheck | PASS, `tsc --noEmit` ở strict mode |
| ESLint | PASS |
| Vitest | 46 tests / 5 files PASS |
| Fixture/adapter | 30 fixture scenarios qua request/response validator; tất cả 18 adapter methods qua mock transport |
| Mutation/lỗi | Partial Anomaly bị từ chối; network, aborted, malformed, 409 và response stream failure phân biệt; retry key/payload không đổi |
| Pagination/races | Response dataset cũ bị bỏ kể cả transport không hủy; đổi filter/sort reset cursor; lỗi tải thêm giữ hàng; retry đúng cursor |
| Production build | PASS; online build không có `transport-*.js` fixture chunk |
| Playwright Chromium | 3 tests PASS: mock desktop + request state/role/direct route/not-found; mobile 390px + keyboard/overflow; online production build gọi URL API và không fallback mock |
| Visual inspection | Đã xem screenshots desktop và mobile; không thấy chồng nội dung/tràn ngang |
| Coverage báo cáo | Statements 82.60%, branches 70.04%, functions 86.66%, lines 91.12% trên scope shared/mocks đã cấu hình, loại generated/test files; không phải coverage toàn MVP |

Máy kiểm tra: Windows, Node 24.14.1, npm 11.11.0; Chromium do Playwright 1.65.0 cung cấp. Screenshot tái tạo bằng `npm run test:e2e` ở `client/test-results/m1-desktop.png` và `m1-mobile.png`, không commit artifacts.

## Phân biệt mức độ tích hợp

Online E2E chạy **build production**, nhưng chặn request health bằng Playwright để kiểm soát success/failure. Adapter test chạy fixture fetch. Backend chưa khởi tạo nên chưa có bằng chứng kết nối end-to-end với API thật, auth/RBAC thật, import/ML thật, CAS thật hoặc idempotent receipt thật. Không đánh dấu các mốc sau hoàn thành dựa trên các test này.

Các dependency liên nhóm R01–R11 trong [M0](m0-readiness.md) vẫn áp dụng. M1 không tự thay OpenAPI/shared schemas, không lưu token bền vững, không chốt detector config hay nguồn timezone import.

## Bàn giao M2

M2 có thể sử dụng ngay adapter/primitives/cursor controller. Việc tiếp theo là login/current user, session online/401/403, guard thật, danh sách imported và workspace shell. Cần chốt R02 về phiên online và R03 về metadata khi deep-link; mock preview role phải được giữ riêng hoặc loại khỏi luồng tài khoản thật.

Tooling: audit production 0 advisory tại thời điểm kiểm tra; full audit có 10 moderate trong chuỗi dev lint dùng minimatch. Không dùng major override chưa được upstream chứng thực chỉ để xóa cảnh báo. Xem hướng dẫn và giới hạn trong [client README](../../client/README.md).
