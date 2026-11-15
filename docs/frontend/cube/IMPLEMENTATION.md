# Cube Analyst — ba chế độ

Triển khai ngày 15/11/2026 theo `CUBE_ANALYST_3_MODES_SPEC.md`. Các ảnh trong `qa/` là ảnh ứng dụng chạy thật qua HTTP interception; các PNG concept ở thư mục cha là tài liệu tham chiếu.

## Chức năng

- **01 Tổng quan:** readings trong cửa sổ 24 giờ mặc định; chọn 48 giờ, 7 ngày hoặc khoảng tùy chọn. Trục X/Y là vị trí trạm, Z là thời gian thực. Một time-slice ±30 phút, timeline qua timestamp đã tải, trước/sau, phát/dừng và tốc độ. Nhận xét và trung bình tính từ dữ liệu, chỉ công bố trung bình toàn bộ trạm khi metadata và readings đầy đủ.
- **02 Theo trạm:** làm nổi bật cột trạm, giữ các trạm còn lại mờ hoặc bật “Chỉ trạm này”. Min/mean/max có scope, biểu đồ theo giờ ngắt ở khoảng thiếu, bảng ngày đang chọn có missing states, chọn reading mở inspector. Trung vị các trạm khác chỉ hiện khi đủ mẫu. CTA sang Mapbox đặt cùng thời điểm và giữ selected reading; inspector báo rõ nếu reading không có trong khung hiện tại.
- **03 Điều tra bất thường:** chọn Analysis Run đã hoàn tất, lọc trạm/status/severity trên các kết quả đã tải. Vòng tím có viền trắng bao quanh reading khớp anomaly chính thức, tâm vẫn giữ màu PM2.5. Danh sách/chi tiết hỗ trợ reading chưa tải, không tạo điểm giả. “Mở review” đọc lại anomaly theo ID, dùng quy trình CAS/version và bảo vệ draft hiện có.
- Palette RGB cố định 0–370 µg/m³, không gắn nhãn sức khỏe. Chọn múi giờ UTC+07 hoặc UTC+08 chỉ thay formatter/giờ nhập, giữ nguyên thời điểm thực.
- Loading, empty, error/retry và partial coverage được phân biệt. Đọc từng trang 100 readings trong scope, dừng ở ngân sách 2.000; còn cursor thì cảnh báo và vô hiệu hóa playback. Tổng dataset lấy từ metadata và tách khỏi số readings đã tải.
- Ba submode dùng chung một renderer/camera. Không reset camera khi chọn reading, đổi mode hoặc đổi scope. Render theo sự kiện; không có vòng animation liên tục. Cleanup controls, listeners, buffers, materials, textures và WebGL context khi rời Cube. Cube và Mapbox không chạy đồng thời.
- Bảng readings và heatmap thời gian bổ trợ dùng chính phạm vi Cube đã tải; thu gọn mặc định. Phần điều hướng ứng dụng và logic heatmap/snapshot Mapbox giữ nguyên.

## File chính

- `client/src/features/workspace/cube-data.ts`: palette, formatter, phép chiếu với domain chung, segmentation theo giờ, thống kê có kiểm tra coverage.
- `client/src/features/workspace/cube-renderer.tsx`: scene Three.js, labels, time-slice, ray picking, camera và cleanup.
- `client/src/features/workspace/cube-explorer.tsx`: phạm vi/pagination, ba panel, timeline, chart và liên kết review.
- `visualization.tsx`: gắn Cube vào tab hiện có, chia sẻ selection và dữ liệu bổ trợ.
- `workspace/page.tsx`, `anomalies/page.tsx`: mở đúng anomaly trong quy trình review hiện có.
- `client/src/app/styles.css`: CSS có scope riêng cho Cube, responsive.

Không thêm dependency, không sửa backend/API/database, không commit/push. `renderer.tsx`, `map-heatmap.ts`, `snapshot.ts`, `heatmap.tsx`, `heatmap-data.ts` và `geometry.ts` không thay đổi.

## Kiểm chứng

- Typecheck, lint và production build đạt. Build có cảnh báo chunk lớn từ Three.js/Mapbox và cảnh báo circular dependency của công cụ generate hiện có.
- **97 unit/integration tests đạt**; thêm 5 trường hợp kiểm tra palette, timezone, tọa độ/thời gian, missing hours và coverage.
- **27 Playwright E2E đạt** (23 cũ + 4 mới): cùng canvas/camera qua ba mode, đỉnh 369/missing hours, đổi timezone, official anomaly → review không tự PATCH, ngân sách 2.000, retry/empty/no run, responsive 1440/1024/390px không tràn ngang.
- Kiểm tra CSV thật bằng `client/scripts/capture-cube.mjs`: 8.782 readings, 12 trạm, 739 timestamps, thiếu 146 trạm–giờ, không duplicate, min/max 3/369. Sự kiện A có 12 trạm và mean 315,5; sự kiện B có 69→84→84→235→369, thiếu 22h/23h, trung vị 11 trạm khác bằng 80. Xem `qa/verification.json`.
- Script CSV đưa số đo thật qua API giả lập trong trình duyệt, gán **QA IDs**, không import hoặc ghi database. Anomaly fixture trong E2E chỉ xác minh contract/luồng UI, không chứng minh detector đã chạy trên CSV.
- Tính tham chiếu ngoài UI trên toàn CSV: z-score dương per sensor, ddof=0, z>3 cho 100 candidates. Đây không phải kết quả anomaly chính thức.
- Không có page error trong các kịch bản Cube. Chưa đo FPS/GPU định lượng hoặc nghiệm thu detector/backend bằng dữ liệu production.

## Ảnh từ CSV thật

- `qa/overview-1440.png`: 16/03/2015 19:00 UTC+08, 287 readings trong cửa sổ ngày, mean tại lát 315,5.
- `qa/station-1440.png`, `qa/station-1024.png`, `qa/station-390.png`: Nongzhanguan 26/03/2015 21:00 UTC+08, 281 readings trong cửa sổ ngày, 22 readings tại trạm.
- `qa/anomaly-empty-1440.png`: CSV không có nhãn anomaly; không chọn run thì không hiển thị kết quả giả.
- `qa/anomaly-official-fixture-1440.png`: kiểm tra UI với một anomaly giả lập đúng contract Server; không phải kết quả detector chạy trên CSV thật.

## Chạy lại

Chạy các lệnh từ `client`. E2E dùng cổng riêng để không chiếm server người dùng ở 5173:

```powershell
npm run typecheck
npm run lint
npm run test
$env:VITE_MAPBOX_TOKEN=''
npm run build
$env:PM25_E2E_MOCK_PORT='5273'
$env:PM25_E2E_ONLINE_PORT='4273'
npx playwright test --workers=2
```

Token rỗng chỉ áp dụng trong tiến trình build/test để kiểm tra fallback; không sửa `.env.local`. Để build thông thường, dùng một shell không có override này.

Để chụp lại CSV, mở preview ở cổng riêng trong một tiến trình rồi chạy script ở tiến trình khác:

```powershell
npm run preview -- --port 4276 --strictPort
node scripts/capture-cube.mjs
```

Script mặc định đọc `../.local/demo-datasets/beijing-12-stations-demo-2015-03.csv`, xuất `../docs/frontend/cube/qa`. Có thể truyền đường dẫn CSV và thư mục ảnh theo thứ tự tham số. Dừng preview sau khi kiểm tra.

## Giới hạn có chủ đích

P0 đã triển khai; không có preview z-score trong UI, animation time-slice mượt hay so sánh nhiều trạm cạnh nhau (P1). Không suy luận thời lượng đợt ô nhiễm khi chưa định nghĩa tiêu chí; không gán nhãn anomaly cho giá trị cao. “Toàn tháng” không có preset tự tải vượt 2.000; khoảng tùy chọn rộng vẫn phải báo coverage thực tế. Đổi sang Mapbox rồi quay lại Cube khởi tạo lại UI Cube; ba submode bên trong Cube giữ nguyên camera và thang thời gian.
