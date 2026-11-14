# Client — PM2.5 Explorer

**M2 frontend đã triển khai:** Register → Login, phiên online bằng sessionStorage, kiểm tra `/users/me` khi reload, guard theo role, xử lý 401/403, logout, danh sách dataset imported có sort/cursor và workspace giữ bộ lọc/tab. Import/3D/analysis/review/admin CRUD vẫn thuộc M3–M7. Backend thật chưa có implementation trong checkout; PWA/Offline/Sync ngoài phạm vi.

Tài phụ trách UI/3D; Duy phụ trách module offline về sau. Interface runtime hiện nằm tại `src/shared/data-source/types.ts`; chưa có xác nhận liên nhóm của Duy.

## Chạy ứng dụng

Yêu cầu Node.js ≥22.12.0 và npm. Đã kiểm tra trên Windows với Node 24.14.1, npm 11.11.0. Chạy từ root repository:

```powershell
npm ci
npm run dev:mock
```

Mở http://127.0.0.1:5173. Đăng nhập mock bằng `analyst01` hoặc `admin01`, mật khẩu `demo-password`. Quyền UI lấy từ tài khoản đăng nhập; không còn dropdown tự đổi quyền. Có thể đăng ký username mới ở `/register`, sau đó đăng nhập thủ công. Mock chỉ lưu username/digest mật khẩu trong RAM, mất khi reload; phiên mock đã đăng nhập vẫn khôi phục được qua mock `/users/me`. Đây là mô phỏng phát triển, không phải password hashing hoặc authentication của Backend thật.

Để dùng transport thật:

```powershell
Copy-Item client/.env.example client/.env.local
npm run dev
```

Vite đọc env trong `client/`, không tự đọc `.env` root. `VITE_API_BASE_URL` mặc định `http://localhost:3001/api/v1`, phải kết thúc đúng `/api/v1`. `VITE_DATA_MODE=mock` cũng bật mock một cách tường minh; không có auto-fallback khi API lỗi. Không đặt biến này nếu muốn kiểm tra online thật. Backend cần cho phép origin dev qua CORS hoặc cấu hình proxy triển khai của nhóm.

`VITE_MAPBOX_TOKEN` chỉ nhận public token `pk.`; có thể để trống đến M4. Không đặt token `sk.`, mật khẩu hoặc JWT secret trong biến `VITE_` vì chúng có thể vào bundle.

Backend hiện chưa có implementation trong checkout. Adapter online đã sẵn sàng cho login/register/me/datasets; cần Backend cung cấp API và tài khoản thật để nghiệm thu tích hợp. Tài khoản mock không dùng được trên Backend thật.

## Lệnh kiểm tra

```powershell
npm run check
npm run test:coverage --workspace @pm25/client
npm exec --workspace @pm25/client -- playwright install chromium
npm run test:e2e
```

- `check`: sinh contract/routes, typecheck, lint, unit/integration tests và build online.
- `test:e2e`: build online, chạy Vite mock ở 5173 và preview online ở 4173, kiểm tra Chromium rồi tự đóng hai server. Cần các cổng này còn trống. Request Backend trong online E2E được Playwright intercept; đây không phải bằng chứng API thật đã triển khai.
- `test:coverage`: báo cáo trong `client/coverage/`; phạm vi cấu hình là `shared/` và `mocks/`, loại generated types/schemas và tests. Không suy ra coverage của toàn bộ MVP.
- `npm run build`: build online vào `client/dist`. Build online mặc định không chứa chunk fixture transport.
- `npm run build:mock --workspace @pm25/client`: bản preview dùng dữ liệu mô phỏng; vẫn có nhãn mock.
- `npm run preview --workspace @pm25/client`: phục vụ build hiện có ở 4173; mode được cố định khi build, không thay bằng env lúc preview.

Không commit `dist`, coverage, Playwright artifacts hoặc env cá nhân. Dependencies được khóa tại `package-lock.json` root; không tạo lockfile riêng trong client.

## Cấu trúc và ranh giới dữ liệu

```text
src/app/                    # config, composition root/provider, shell, styles
src/routes/                 # file-based routes; auth/datasets/workspace và placeholders M3–M7
src/features/auth/          # Register, Login, session và route guard
src/features/datasets/      # danh sách, sort, cursor và metadata phiên
src/features/workspace/     # filters, tabs, state theo dataset
src/features/foundation/    # placeholders còn lại và connection check
src/shared/api/             # HTTP client, validation, lỗi, idempotency
src/shared/api/generated/   # OpenAPI-derived types + schemas; không sửa tay
src/shared/data-source/     # interface và adapter online
src/shared/lib/             # cursor lifecycle và response-race protection
src/shared/ui/              # primitives/loading/empty/error/retry
src/mocks/                  # injectable fetch transport; không service worker
```

Nguồn contract duy nhất là `docs/api/openapi.yaml`. Trong bước migration code có phối hợp (không phải đợt docs D008), chạy `npm run generate --workspace @pm25/client` sau khi contract thay đổi: `openapi-typescript` tạo kiểu HTTP, script trích 20 operations online và 33 schemas liên quan để AJV kiểm tra request/response. `routeTree.gen.ts` được TanStack sinh; khi thêm routes, plugin Vite cũng cập nhật cây route.

Pipeline: page/hook → `OnlineDataSource` → online adapter → HTTP client → fetch thật hoặc fixture transport. Single-resource được unwrap thành DTO; page giữ `{data,page}`; validation/login/health giữ envelope riêng; analysis create giữ `{data}`, get unwrap AnalysisRun theo D008. Không import source Zod chưa khởi tạo của shared-core để áp validator chặt hơn OpenAPI.

HTTP client hỗ trợ Bearer từ token getter, JSON/multipart, cancellation, phân loại http/network/aborted/invalid-response, schema validation và query defaults. Không log token/password, không tự hiển thị raw error details, không tự retry mutation.

### Quy ước cho các feature từ M2

1. Session giữ riêng token trong `sessionStorage` theo mode (`pm25.auth.online` / `pm25.auth.mock`); user/role được kiểm tra lại qua `/users/me` khi reload. 401 của request mang token hiện tại xóa phiên; 403 báo cấm quyền, không tự logout. Logout xóa token, metadata và workspace state. Không refresh token, không auto-login sau Register.
2. Dùng `createIdempotentOperation(input, send)` cho một ý định upload/import/analysis/create-user. Object này giữ key UUID và snapshot payload; gọi lại `.run()` để retry cùng thao tác, tạo object mới khi người dùng đổi ý định. Gửi trùng khi pending được gộp thành cùng Promise. Hủy request hoặc mất response không có nghĩa Server chưa xử lý.
3. PATCH review dùng baseVersion, không dùng helper retry tự động. 409 phải lấy lại chi tiết và giữ bản nhập như kế hoạch M6.
4. Dùng `createCursorPager` cho mỗi list. `setQuery` với dataset/filter/sort mới xóa cursor và data cũ, abort request cũ, bỏ response trễ; `loadMore` giữ data khi lỗi, `retry` dùng lại cursor lỗi. Subscribe bằng cơ chế state của feature; gọi dispose khi bỏ controller.
5. Renderer chỉ nhận DTO/view model; không gọi fetch hoặc lưu dữ liệu bền vững.
6. Duy có thể bọc adapter ở composition root. Một outbox write không được trả về như Anomaly đã được Server xác nhận; khi thêm offline phải thống nhất result semantics mới.

## Giới hạn mock và tooling

Mock có list/filter/sort/cursor, cancellation/delay, chọn lỗi, tài khoản demo và Register/Login trong RAM; mutations nghiệp vụ khác vẫn trả fixture minh họa. Mock **không** giả lập đầy đủ database, CAS, receipt idempotency hoặc trạng thái import. Kiểm thử helper retry xác minh key/payload phía client, không chứng minh chống trùng phía Server.

Tại lần kiểm tra M1, `npm audit --omit=dev` không có advisory production; audit đầy đủ báo 10 moderate trên chuỗi lint tooling dùng minimatch 10.2.6. Chưa ép override major dependency của ESLint/typescript-eslint; cần cập nhật khi upstream hỗ trợ phiên bản vá. TanStack CLI hiện in cảnh báo circular dependency khi generate; generation, typecheck và build vẫn thành công. Những giới hạn này không được diễn giải thành API/Frontend đã nghiệm thu toàn bộ P0.

Tham khảo cấu hình chính thức: [TanStack Router + Vite](https://tanstack.com/router/latest/docs/installation/with-vite), [Vite](https://vite.dev/guide/), [Vitest](https://vitest.dev/guide/). Bằng chứng thực hiện nằm tại [M1 verification](../docs/frontend/m1-verification.md).


## Bằng chứng M2

Xem [M2 verification](../docs/frontend/m2-verification.md). Deep-link thiếu metadata hiển thị datasetId và thông báo chưa xác nhận tồn tại, không scan tất cả dataset. Bộ lọc trạm/bbox/thời gian được giữ trong phiên khi đổi tab; truy vấn/render dữ liệu nối ở M4. Register chỉ gửi username/password, không role; 409 báo trùng, 422 báo dữ liệu sai, 201 chuyển Login không tạo phiên.

## Bằng chứng M3

Xem [M3 verification](../docs/frontend/m3-verification.md). Import Wizard giữ ID/key trong sessionStorage theo mode, file/tên bất biến trong RAM cho retry upload; tự quản lý key thay helper để phục hồi qua reload. Không tự resend mutation. Chỉ nhận nguồn có Z/offset và ug/m3; failed cần Backend xác nhận cleanup. E2E kiểm tra adapter online bằng HTTP interception, chưa thay thế nghiệm thu với API thật.

## Bằng chứng M4

Xem [M4 verification](../docs/frontend/m4-verification.md). Workspace tải readings/sensors từng trang 100, giới hạn phiên 2.000; Cube và Mapbox chia sẻ selection. Mapbox cần public `VITE_MAPBOX_TOKEN` tại build, thiếu token vẫn dùng Cube/bảng. Chưa nghiệm thu tiles thật hoặc API Backend thật.

## D008 / M5 đã migrate (14/11/2026)

Generated types/schema, adapter create/get/list, mock và shared-core đã cập nhật D008. Xem [M5 verification](../docs/frontend/m5-verification.md). Form thật gửi zscore `{threshold:3}` hoặc iqr `{multiplier:1.5}`; ML Isolation Forest khóa chờ method/config API. History và run deep-link dùng `?runId=...`, poll có backoff/visibility, kết quả chỉ tải sau completed. Bbox chặn gửi; retry unknown POST thật khóa vì retention chưa chốt. Mock mô phỏng lifecycle/replay trong RAM, không engine/database; reload mất run demo mới, fixture lịch sử vẫn có. Backend thật/ML chưa nghiệm thu.
