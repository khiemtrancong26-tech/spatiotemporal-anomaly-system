# Client — PM2.5 Explorer

**M1 đã triển khai:** React/Vite/TypeScript, TanStack Router file-based routing, giao diện nền responsive, adapter API online và fixture transport. Các trang login/datasets/import/workspace/admin hiện là khung cho M2–M7, chưa phải chức năng nghiệp vụ hoàn chỉnh. PWA/Offline/Sync không thuộc lần triển khai này.

Tài phụ trách UI/3D; Duy phụ trách module offline về sau. Interface runtime hiện nằm tại `src/shared/data-source/types.ts`; chưa có xác nhận liên nhóm của Duy.

## Chạy ứng dụng

Yêu cầu Node.js ≥22.12.0 và npm. Đã kiểm tra trên Windows với Node 24.14.1, npm 11.11.0. Chạy từ root repository:

```powershell
npm ci
npm run dev:mock
```

Mở http://127.0.0.1:5173. Bản mock có nhãn rõ, chọn vai trò xem thử và tình huống success/network error/server error/malformed response. Vai trò xem thử không phải xác thực thật. Không cần Backend hay tài khoản để xem M1 mock.

Để dùng transport thật:

```powershell
Copy-Item client/.env.example client/.env.local
npm run dev
```

Vite đọc env trong `client/`, không tự đọc `.env` root. `VITE_API_BASE_URL` mặc định `http://localhost:3001/api/v1`, phải kết thúc đúng `/api/v1`. `VITE_DATA_MODE=mock` cũng bật mock một cách tường minh; không có auto-fallback khi API lỗi. Không đặt biến này nếu muốn kiểm tra online thật. Backend cần cho phép origin dev qua CORS hoặc cấu hình proxy triển khai của nhóm.

`VITE_MAPBOX_TOKEN` chỉ nhận public token `pk.`; có thể để trống đến M4. Không đặt token `sk.`, mật khẩu hoặc JWT secret trong biến `VITE_` vì chúng có thể vào bundle.

Backend hiện chưa có implementation trong checkout. M1 online chỉ cung cấp nút kiểm tra health; tài khoản thật và chính sách giữ token sẽ làm ở M2. Không có tài khoản mẫu nào trong fixtures dùng được trên Backend thật.

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
src/routes/                 # file-based routes; placeholder feature pages
src/features/foundation/    # M1 shell content + connection check
src/shared/api/             # HTTP client, validation, lỗi, idempotency
src/shared/api/generated/   # OpenAPI-derived types + schemas; không sửa tay
src/shared/data-source/     # interface và adapter online
src/shared/lib/             # cursor lifecycle và response-race protection
src/shared/ui/              # primitives/loading/empty/error/retry
src/mocks/                  # injectable fetch transport; không service worker
```

Nguồn contract duy nhất là `docs/api/openapi.yaml`. Chạy `npm run generate --workspace @pm25/client` sau khi contract thay đổi: `openapi-typescript` tạo kiểu HTTP, script trích 18 operations online và schemas liên quan để AJV kiểm tra request/response. `routeTree.gen.ts` được TanStack sinh; khi thêm routes, plugin Vite cũng cập nhật cây route.

Pipeline: page/hook → `OnlineDataSource` → online adapter → HTTP client → fetch thật hoặc fixture transport. Single-resource được unwrap thành DTO; page giữ `{data,page}`; validation/login/health giữ envelope riêng; analysis giữ `{data,anomalies}`. Không import source Zod chưa khởi tạo của shared-core để áp validator chặt hơn OpenAPI.

HTTP client hỗ trợ Bearer từ token getter, JSON/multipart, cancellation, phân loại http/network/aborted/invalid-response, schema validation và query defaults. Không log token/password, không tự hiển thị raw error details, không tự retry mutation.

### Quy ước cho các feature từ M2

1. Inject token getter/session khi M2 chốt xác thực; M1 online getter trả undefined. Không lưu token qua mock preview store hoặc tự thêm refresh API.
2. Dùng `createIdempotentOperation(input, send)` cho một ý định upload/import/analysis/create-user. Object này giữ key UUID và snapshot payload; gọi lại `.run()` để retry cùng thao tác, tạo object mới khi người dùng đổi ý định. Gửi trùng khi pending được gộp thành cùng Promise. Hủy request hoặc mất response không có nghĩa Server chưa xử lý.
3. PATCH review dùng baseVersion, không dùng helper retry tự động. 409 phải lấy lại chi tiết và giữ bản nhập như kế hoạch M6.
4. Dùng `createCursorPager` cho mỗi list. `setQuery` với dataset/filter/sort mới xóa cursor và data cũ, abort request cũ, bỏ response trễ; `loadMore` giữ data khi lỗi, `retry` dùng lại cursor lỗi. Subscribe bằng cơ chế state của feature; gọi dispose khi bỏ controller.
5. Renderer chỉ nhận DTO/view model; không gọi fetch hoặc lưu dữ liệu bền vững.
6. Duy có thể bọc adapter ở composition root. Một outbox write không được trả về như Anomaly đã được Server xác nhận; khi thêm offline phải thống nhất result semantics mới.

## Giới hạn mock và tooling

Mock có list/filter/sort/cursor, cancellation/delay, chọn lỗi và role preview; mutations trả fixture minh họa. Mock **không** giả lập đầy đủ database, CAS, receipt idempotency hoặc trạng thái import. Kiểm thử helper retry xác minh key/payload phía client, không chứng minh chống trùng phía Server.

Tại lần kiểm tra M1, `npm audit --omit=dev` không có advisory production; audit đầy đủ báo 10 moderate trên chuỗi lint tooling dùng minimatch 10.2.6. Chưa ép override major dependency của ESLint/typescript-eslint; cần cập nhật khi upstream hỗ trợ phiên bản vá. TanStack CLI hiện in cảnh báo circular dependency khi generate; generation, typecheck và build vẫn thành công. Những giới hạn này không được diễn giải thành API/Frontend đã nghiệm thu toàn bộ P0.

Tham khảo cấu hình chính thức: [TanStack Router + Vite](https://tanstack.com/router/latest/docs/installation/with-vite), [Vite](https://vite.dev/guide/), [Vitest](https://vitest.dev/guide/). Bằng chứng thực hiện nằm tại [M1 verification](../docs/frontend/m1-verification.md).

