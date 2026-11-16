# Shared readings / liên kết Mapbox–Cube — 17/11/2026

Thiết kế theo 6 quyết định chủ dự án đã chốt; Desktop ≥1024px.

- RAM cache cấp phiên, mặc định 50.000 Reading theo dataset+ID, LRU. Trang giữ query đầy đủ (dataset/sensor/bbox/from/to/sort/limit/cursor). Không trộn cursor giữa query. Coverage chỉ hoàn tất khi chuỗi từ trang đầu đến nextCursor=null đã xác minh; page lỗi/hủy không hoàn tất coverage.
- Lookup đầy đủ có thể dùng coverage rộng hơn hoặc ghép các khoảng hoàn tất tương thích, không có lỗ hổng. Mọi ID của coverage phải còn trong cache. Khi LRU xóa record, trang/coverage phụ thuộc không còn dùng được. Tập đang hiển thị vẫn giữ DTO riêng, không bị mất khỏi màn hình khi cache loại record. Metadata trang/query cũng có ngân sách riêng.
- Không tạo cursor giả hoặc suy completeness từ số records. Mapbox đọc từng trang 100, thay trang hiện tại và giữ stack cursor để quay lại; không giữ 500k records trong React state. Snapshot quét hết cửa sổ maxAge, giữ một reading/trạm và dùng cache nếu cửa sổ đã đầy đủ. Cube tự đọc đến hết hoặc ngưỡng 2.000; có cursor tại ngưỡng thì khóa toàn bộ phần chi tiết, không render Cube hoặc thống kê từ tập cắt cụt.
- Requests trùng trang chia sẻ transport nhưng cancellation mỗi consumer độc lập; hết consumer thì abort. Clear có generation để response cũ không chèn lại cache. Logout/đổi phiên xóa cache. Refresh chủ động xóa cache và đọc lại; không hứa realtime/snapshot isolation nếu dữ liệu Server bị thay đổi giữa requests.
- Ngữ cảnh T, trạm focus và cửa sổ Cube thuộc Workspace. Mapbox selection không thay T; Cube chọn reading/lát đổi T. Chuyển mode giữ selection/focus và scope Workspace; camera không đồng bộ. Cửa sổ mặc định ±12h quanh T, cắt biên Workspace. Cửa sổ do user chọn được giữ nếu chứa T, nếu không dịch theo T nhưng giữ độ dài trước khi cắt biên.
- Histogram gần Cube dùng API aggregate hiện có: đếm toàn bộ scope Workspace, theo các trạm đầy đủ; chia truy vấn theo giới hạn contract khi cần. Không dùng raw points/cache partial làm số đếm toàn dataset. Chọn khoảng trên biểu đồ chỉ đổi scope Cube.

Không đổi Backend/OpenAPI/Shared Data Contract, không đổi màu/heatmap engine/maxAge. 500.000 là mục tiêu cần kiểm thử, không tự công bố benchmark đạt.

## Kiểm chứng triển khai

- `npm run typecheck --workspace @pm25/client`, `npm run lint --workspace @pm25/client`, production build: đạt. Build còn cảnh báo kích thước chunk Three.js hiện có.
- Toàn bộ FE unit tests: **123 tests / 19 files đạt**. Bao gồm completeness/ghép coverage/LRU/cancellation/race, biên Cube 1.999/2.000/2.001, snapshot vượt 2.000 raw readings và tie-break cache/network nhất quán, phân bố chia trạm/thời gian và từ chối số đếm/metadata sai.
- Kiểm thử duyệt **500.000 readings mô phỏng / 5.000 trang**: truy cập đến record cuối, cache ≤50.000 records và ≤256 trang metadata; không xác nhận coverage khi records đã bị loại.
- Playwright `shared-visualization.spec.ts`, Chromium online build, HTTP fixtures mô phỏng dataset 500.000 readings: **5 tests đạt**, chỉ Desktop. Kiểm tra T sâu ở reading thứ 360.000, giữ selection/focus/T, reuse coverage khi Cube → Mapbox không thêm raw request, giữ canvas qua lát/chế độ con, chặn Cube quá ngưỡng, chọn khoảng bằng histogram, duyệt 22 trang Mapbox và thay trang, sort/refresh, lỗi trang sau/retry, giữ/dịch cửa sổ 48 giờ. Không sửa assertions cũ để bỏ qua lỗi.
- Screenshots đã kiểm tra trực quan: `client/test-results/shared-cube-1440.png` (1440×900), `client/test-results/shared-cube-1366.png` (1366×768), full page. Không phát hiện overflow ngang trong hai viewport. Chọn khoảng từ histogram cập nhật cả query lẫn trường thời gian đang hiển thị.

Lệnh E2E: tại `client`, đặt `PM25_E2E_MOCK_PORT=5273`, `PM25_E2E_ONLINE_PORT=4273`, `VITE_MAPBOX_TOKEN=''`, chạy `npx playwright test e2e/shared-visualization.spec.ts --project=chromium-online --workers=1`. Các cổng thử riêng không chiếm 5173 của phiên làm việc. Các suite E2E khác không chạy trong lượt này; không chạy bước Mobile/Tablet cũ.

## File thay đổi

- Cache/tải dữ liệu: `client/src/features/workspace/readings-cache.ts`, `cube-readings.ts`, `snapshot.ts`; nối cấp phiên tại `client/src/app/services.tsx`.
- Ngữ cảnh/giao diện: `client/src/features/workspace/state.ts`, `cube-data.ts`, `cube-explorer.tsx`, `visualization.tsx`; histogram mới `reading-distribution-data.ts`, `reading-distribution.tsx`; Desktop CSS tại `client/src/app/styles.css`.
- Kiểm thử: `client/src/features/workspace/readings-cache.test.ts`, `reading-distribution-data.test.ts`, `snapshot.test.ts`, `state.test.ts`; `client/e2e/shared-visualization.spec.ts`, `client/playwright.config.ts`.
- Tài liệu: `client/README.md`, `docs/frontend-online-plan.md`, `docs/frontend/heatmap-timeline.md`, tài liệu này.

## Giới hạn đã biết

Chưa import CSV 500.000 dòng vào MongoDB thật, chưa đo RAM trình duyệt/FPS/độ trễ Backend với dataset đó. E2E dùng API fixtures và không có Mapbox token; chưa kiểm chứng tiles/network/crossfade Mapbox thật trong lượt này. Các module renderer, camera, heatmap mềm và heatmap ngày × giờ không bị sửa. Cache RAM mất khi tải lại trang và không bảo đảm snapshot isolation nếu Server thay đổi dữ liệu giữa các trang. Histogram tối đa 4.000 khoảng ở độ phân giải đã chọn, vượt thì báo chọn ngày/thu hẹp; lỗi/giới hạn của API aggregate hiện có được hiển thị, không thay bằng số đếm từ cache. Snapshot có timeout 20 giây; Cube timeout 20 giây/trang; timeout không công bố dữ liệu dở. Không commit/push.
