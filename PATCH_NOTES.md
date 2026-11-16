# Duy Offline Foundation – develop overlay

Patch này được tạo trực tiếp trên source `spatiotemporal-anomaly-system-develop.zip` do nhóm cung cấp, không dùng lại overlay cũ. Các thay đổi Cube, Heatmap, timeline và giao diện develop được giữ nguyên.

## Thành phần được thêm

- Dexie / IndexedDB với các bảng datasets, sensors, readings, analysisRuns, anomalies, coverage, outbox, workspace và meta.
- Auto-cache khi các list/detail API đọc thành công trong lúc đã xác định tài khoản.
- Offline DataSource bọc OnlineDataSource, lọc dữ liệu cache theo dataset, sensor, bbox, thời gian và filter hiện có.
- Fallback chỉ cho lỗi mạng và HTTP 502/503/504. Không dùng cache để che lỗi 401/403, lỗi validation hay request bị hủy.
- Coverage metadata theo query scope và chuỗi cursor; chỉ đánh dấu scope hoàn tất khi đã cache đủ chuỗi trang đến `nextCursor: null`.
- Connectivity Service kết hợp `navigator.onLine` và health check `/api/v1/health`, trạng thái `online`, `degraded`, `offline`.
- Workbox precache app shell; API không được cache trong Cache Storage, dữ liệu nghiệp vụ nằm trong Dexie.
- Lưu/khôi phục dataset, filter, tab, selected reading theo tài khoản và dataset.
- Lưu review offline theo DTO `OfflineReviewMutation` hiện tại trong Outbox; UI phân biệt lưu cục bộ với Server xác nhận.
- Hai nhóm unit test cho pagination helper và connectivity service.

## Những phần chưa được tuyên bố là hoàn tất

- Các endpoint `GET /api/v1/exports`, `POST /api/v1/review-mutation-batches`, `GET /api/v1/review-changes` chưa có Backend handler trong source develop hiện tại; vì vậy chưa có Push/Pull tự động.
- Auth hiện vẫn khôi phục phiên bằng `sessionStorage` và gọi `/auth/me`; mở tab mới/reload lạnh hoàn toàn khi offline có thể bị AuthGate chặn. Cần thống nhất bảo mật với nhóm trước khi thay đổi cách lưu token.
- Chưa lưu trạng thái camera Mapbox/Three.js, visualization mode, timestamp và maxAge vào workspace vì cần thống nhất state contract với Frontend owner.
- Chưa triển khai Web Worker thống kê: policy hiện tại chưa được xuất từ shared-core để Client dùng đúng cùng cấu hình Backend.
- Export/prefetch chưa nối vì hợp đồng phân trang nhiều collection NEW-03/NEW-04 và Backend route chưa được chốt/triển khai.

## Cách áp dụng

1. Backup hoặc tạo branch mới từ `develop`.
2. Giải nén overlay vào thư mục gốc repository, giữ nguyên cấu trúc thư mục tương đối.
3. Tại thư mục gốc monorepo chạy `npm install`. Lệnh này phải cập nhật `package-lock.json` với dependency mới (`dexie`, `vite-plugin-pwa`). Không dùng `npm ci` trước khi lockfile được cập nhật.
4. Chạy:

```bash
npm run typecheck --workspace @pm25/client
npm test --workspace @pm25/client
npm run build --workspace @pm25/client
npm run preview --workspace @pm25/client
```

Service Worker/PWA cần kiểm tra trên bản build/preview; Vite dev mode không đăng ký production worker theo cấu hình này.

## Kiểm tra đã thực hiện khi đóng gói

- Đã kiểm tra JSON hợp lệ của `client/package.json`.
- Đã dùng TypeScript `transpileModule` parse 75 file `.ts/.tsx` trong `client/src`: không có lỗi cú pháp.
- Chưa chạy full typecheck, Vitest hoặc Vite build trong môi trường đóng gói vì `node_modules` không có sẵn và cài package từ npm registry không hoàn tất. Cần chạy lại trên máy nhóm sau `npm install`.

## Danh sách file

Overlay chứa 21 file (9 file hiện có được cập nhật và 12 file mới). Không bao gồm `package-lock.json`; lockfile phải được tạo lại bằng `npm install` tại repo gốc.


## Cập nhật bổ sung — Khởi tạo IndexedDB sớm

- `offlineDb` được khởi tạo trong `bootstrap()` trước khi React render giao diện, không cần chờ API đọc dữ liệu thành công.
- Nếu khởi tạo IndexedDB thất bại, hệ thống ghi log lỗi nhưng vẫn cho phép ứng dụng hiển thị giao diện.
- Bổ sung unit test kiểm tra cơ chế khởi tạo một lần và xử lý lỗi an toàn.
- Bổ sung Playwright test kiểm tra database và các object store thực tế trên trình duyệt.

## Cập nhật bổ sung — Outbox và hợp đồng Sync

- Bổ sung Outbox Repository để quản lý các thao tác đánh giá bất thường khi offline.
- Hỗ trợ cập nhật dữ liệu cục bộ theo cơ chế optimistic update, gộp các mutation chưa gửi, theo dõi số lần thử và xử lý trạng thái xung đột hoặc bị từ chối.
- Bổ sung 15 unit test cho Outbox, bao gồm kiểm tra dữ liệu đầu vào, phạm vi tài khoản, xử lý xung đột và xác nhận kết quả.
- Bổ sung `fake-indexeddb` để hỗ trợ kiểm thử IndexedDB trong môi trường Vitest.
- Bổ sung công cụ sinh hợp đồng Sync từ đặc tả OpenAPI hiện có.
- Sinh hợp đồng và kiểu dữ liệu cho ba API: exports, review-changes và review-mutation-batches.
- Mở rộng HTTP Client và cơ chế kiểm tra dữ liệu để hỗ trợ hợp đồng API bổ sung.

## Kết quả kiểm thử trên máy phát triển

- `npm run typecheck --workspace @pm25/client`: thành công.
- `npm test --workspace @pm25/client`: 122 test thành công.
- `npx vitest run src/offline/`: 25 test thành công.
- `npm run build --workspace @pm25/client`: thành công.
- `npx playwright test e2e/offline-storage.spec.ts --project=chromium-online`: 1 test thành công.
- Toàn bộ Playwright E2E: 28 test được thực thi, 15 thành công và 13 thất bại. Các lỗi còn lại cần được kiểm tra riêng, chưa được xem là đã khắc phục.
- `git diff --cached --check`: không phát hiện lỗi khoảng trắng.

## Những giới hạn hiện tại

- Backend chưa triển khai các handler cho `GET /api/v1/exports`, `POST /api/v1/review-mutation-batches` và `GET /api/v1/review-changes`. Vì vậy, chức năng đồng bộ Push/Pull thực tế với máy chủ chưa hoạt động.
- Cơ chế xác thực vẫn sử dụng `sessionStorage` và gọi `/auth/me`. Việc tải lại ứng dụng hoàn toàn khi offline có thể bị AuthGate chặn.
- Chưa lưu trạng thái camera Mapbox/Three.js và các trạng thái trực quan hóa chuyên biệt.
- Chưa triển khai thống kê bằng Web Worker và các quy trình export/prefetch.

## Danh sách thành phần

Phần triển khai hiện tại bao gồm lưu trữ Offline, bộ nhớ đệm dữ liệu, quản lý kết nối, hàng đợi Outbox, lưu trạng thái Workspace, cấu hình PWA, công cụ sinh hợp đồng Sync, tích hợp API Client, kiểm thử và tài liệu hướng dẫn.

Tổng cộng có 33 file đang được đưa vào staging. `package-lock.json` được đưa vào vì dự án có bổ sung và cập nhật dependency.
