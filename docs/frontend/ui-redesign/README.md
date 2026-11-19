# UI/UX redesign — PM2.5 Explorer

Ngày 15/11/2026. Triển khai trực tiếp trên React/CSS hiện có, không thêm dependency hoặc thay Backend/OpenAPI/Shared Data Contract. Hai heatmap được người dùng chọn bổ sung trong chat.

## Audit và thay đổi

| Vấn đề trước đây | Thiết kế hiện tại |
|---|---|
| Component dính nhau, kiểu form/bảng không đều | Tokens cho màu, radius, shadow và spacing 4/8px; input 42px, button 40px, nhóm form có khoảng cách và mặt nền phụ |
| Sidebar Unicode và nhãn milestone dành cho developer | SVG icons nội bộ, active state rõ, user/avatar/role và nhãn Online/Demo |
| ID/scope/config và chú thích dài chiếm toàn trang | Inspector phân cấp, metadata/kỹ thuật trong disclosure; trạng thái run có badge chữ và dấu nhận diện |
| Bảng tràn ngang, textarea chưa có style | Vùng cuộn riêng có keyboard focus/accessible label, table/tabular numerals, textarea thống nhất |
| Import thiếu định hướng thị giác | Chỉ dẫn 4 bước, nhóm field/báo cáo và hành động theo cùng thiết kế; không thay flow |

Tái dùng typography hệ thống (Inter nếu máy có, fallback Segoe UI/system-ui), không tải webfont hay bộ icon từ mạng. Màu PM2.5 trong `geometry.ts` giữ nguyên. Focus-visible, skip link, semantic table, label, reduced-motion và fallback lỗi vẫn có. Không thêm fake KPI, forecast, dữ liệu online giả, hay nhãn cảnh báo sức khỏe.

## Heatmap và phạm vi dữ liệu

- **Ngày × giờ:** trung bình các readings đã tải theo giờ UTC+07 trên các trạm trong bộ lọc; hiển thị tối đa 14 ngày có mẫu gần nhất. Các ngày này không nhất thiết liên tiếp. Ô có số, tên truy cập/tooltip có trung bình và số mẫu. Không có mẫu hiển thị dấu gạch riêng, không thay bằng 0. Thang màu dùng min/max readings đã tải như Cube/Mapbox.
- **Không gian:** lớp polygon ô 0,02° × 0,02° chỉ ở nơi có mẫu; trung bình từ đúng các điểm Mapbox đang hiển thị (tất cả trạm có mẫu đúng thời điểm đã chọn, đọc riêng các trang bằng from=to). Ô có count/mean và màu theo cùng scale PM2.5, opacity 0,6, điểm chọn và viền anomaly còn ở trên. Đây là grid tổng hợp, không phải bề mặt nồng độ liên tục, mô hình không gian hay nội suy như các ảnh raster tham khảo. 0,02° không được gọi là khoảng cách km cố định.
- Bật/tắt lớp không gian dùng `setLayoutProperty`, không tạo lại map. Mở/thu bộ lọc không đổi key của renderer. Giữ camera/selection/polling và các lifecycle cleanup hiện có; Cube chỉ đổi kích thước theo chiều cao container responsive thay vì hardcode 420px.
- Aggregates chỉ là view từ DTO đã tải; không ghi store nghiệp vụ, không gửi query hay thay giới hạn/cursor/filter semantics. Sensors metadata vẫn không lọc thời gian.

## Screenshots

Tất cả ảnh dùng **mock có nhãn**, không phải bằng chứng chạy detector hoặc dữ liệu thực tế. Cùng browser Chromium và tài khoản admin demo, chụp 1440×1000, full-page.

| Màn | Trước 1440 | Sau 1440 |
|---|---|---|
| Login | [Desktop](before/login-1440.png) | [Desktop](after/login-1440.png) |
| Register | [Desktop](before/register-1440.png) | [Desktop](after/register-1440.png) |
| Datasets | [Desktop](before/datasets-1440.png) | [Desktop](after/datasets-1440.png) |
| Workspace | [Desktop](before/workspace-1440.png) | [Desktop](after/workspace-1440.png) |
| Import | [Desktop](before/import-1440.png) | [Desktop](after/import-1440.png) |
| Analysis | [Desktop](before/analysis-1440.png) | [Desktop](after/analysis-1440.png) |
| Anomalies | [Desktop](before/anomalies-1440.png) | [Desktop](after/anomalies-1440.png) |
| Review | [Desktop](before/review-1440.png) | [Desktop](after/review-1440.png) |
| Admin | [Desktop](before/admin-1440.png) | [Desktop](after/admin-1440.png) |

## Kiểm chứng

- Typecheck, lint, 80 unit/integration tests (12 files), production build: đạt.
- Screenshot script kiểm tra overflow toàn trang của 9 màn ở kích thước Desktop. Đã kiểm tra hình ảnh các bố cục chính, sửa sticky/scroll capture và đưa filters ra khỏi luồng đầu của canvas desktop.
- Unit mới: rollover ngày UTC+07/offset tương đương, mean/count, không có mẫu, ô địa lý có mẫu và biên tọa độ; mock Mapbox kiểm tra source/layer/visibility, bật heatmap không tạo instance mới và unmount gọi cleanup.
- E2E fallback chạy với `VITE_MAPBOX_TOKEN` rỗng chỉ trong environment của tiến trình test; không ghi đè token local. Build thêm với token môi trường local đạt, gồm nhánh bundling Mapbox/CSS. Còn cảnh báo circular dependency TanStack CLI và Three.js/Mapbox chunks lớn như trước.

## File thay đổi

- Shell/design system: `client/src/app/styles.css`, `app/shell.tsx`, `shared/ui/primitives.tsx`, SVG `shared/ui/icons.tsx`.
- Workspace: `features/workspace/page.tsx`, `visualization.tsx`, `renderer.tsx`; mới `heatmap.tsx`, `heatmap-data.ts`.
- Các màn còn lại: `features/auth/pages.tsx`, `auth/register.tsx`, `datasets/page.tsx`, `dataset-import/page.tsx`, `analysis/page.tsx`, `analysis/results.tsx`, `anomalies/page.tsx`, `admin-users/page.tsx` (chỉ markup/presentation/accessibility).
- Kiểm chứng qua `client/e2e/mock-application-workflows.spec.ts`, `client/tests/unit/workspace/heatmap-data.test.ts`, `client/tests/integration/workspace/mapbox-renderer.integration.test.tsx` và `client/scripts/capture-ui.mjs`.
- Tài liệu: `client/README.md`, `docs/frontend-online-plan.md`, báo cáo và ảnh trong thư mục này. Các đường dẫn feature/shared bên trên tương đối với `client/src`.

## Giới hạn

Lần thử Mapbox với token môi trường tạo được canvas/control nhưng nền tiles chưa hiện; [ảnh lần thử](after/map-heatmap-1440.png) không được tính là nghiệm thu tiles hay lớp grid thật. Source/layer/toggle đã kiểm tra bằng mock, cần môi trường dịch vụ Mapbox tải thành công để xác nhận hình ảnh thực. Chưa đo lại FPS/GPU/tổng memory trên bộ dữ liệu lớn hoặc thử mọi thiết bị cảm ứng. Không yêu cầu người dùng lặp lại các luồng đã kiểm tra tự động. Backend/ML quality và phạm vi PWA/Offline/Sync giữ nguyên; không commit/push.


## Workspace v2 — sửa theo phản hồi sử dụng thực tế


Bằng chứng Mapbox v2 ngày 15/11: đã tải được nền/tiles trong phiên QA riêng và chụp ba trạm cùng T ở 1440px; xem báo cáo v2. Giới hạn Mapbox ở bản chụp v1 phía trên là ghi nhận lịch sử.


Chính sách snapshot/grid trong các phần lịch sử trên đã được thay bằng [heatmap mềm + latest ≤ T, maxAge 2 giờ](../heatmap-timeline.md) theo xác nhận tiếp theo của người dùng.
