# M4 — Tra cứu và trực quan online

Ngày: 2026-11-13.

## Đã triển khai

- Sensors/readings đi qua online adapter, 100 bản ghi/trang; tải thêm do người dùng yêu cầu, reset cursor và hủy/bỏ response cũ khi đổi dataset/filter/sort. Bbox và UTC+07 dùng validation M2. Sensors chỉ lọc dataset/bbox theo contract; không giả lọc thời gian.
- Một tập readings chung cho Cube/Mapbox/bảng/panel. Cube giữ từng thời điểm; Mapbox lấy mới nhất trong phần đã tải của mỗi trạm, hoặc reading đang chọn. Trạm trùng tọa độ chọn bằng bảng. Quy tắc có nhãn rõ; không coi trang đầu là toàn bộ dataset.
- Cube Three.js: XY chiếu equirectangular cục bộ, tỷ lệ XY chung, Z thời gian chuẩn hóa độc lập; trục, khung, phạm vi lon/lat/thời gian, legend PM2.5, xoay/pan/zoom/reset và raycast chọn reading. Phép chiếu dành cho vùng nghiên cứu cục bộ, không phải khoảng cách địa trắc hay hỗ trợ wrap qua kinh tuyến 180°.
- Mapbox GL JS: nền light-v11, camera nghiêng, circle layer theo giá trị, chọn điểm, fit/reset và navigation control. Cần public `VITE_MAPBOX_TOKEN` lúc build. Thiếu token/lỗi tiles/WebGL có thông báo và giữ bảng/Cube.
- Renderer tải lazy; chỉ mode hiện tại được mount. Dispose controls, observer, geometry/material, WebGL renderer/context hoặc map khi đổi mode/rời màn. Cube render theo sự kiện, không có render loop thường trực.
- Panel hiển thị reading, sensor (hoặc ID khi chưa tải metadata), UTC+07, giá trị/tọa độ; anomaly ghi chưa tải và nối ở M6.

## Kiểm chứng và ngân sách ban đầu

- `npm run check`: typecheck/lint, 62 tests, production build. Geometry tests kiểm tra hướng tọa độ, thời gian có offset, điểm đơn và chọn mới nhất/điểm lịch sử.
- `npm run test:e2e`: 9/9 tests đạt. E2E M4 trên online build dùng HTTP interception: chọn reading, chuyển mode giữ selection, Cube có canvas, thiếu token có fallback, tải cursor một lần, lọc UTC+07 và dữ liệu rỗng xóa selection. Bộ E2E M2/M3 tiếp tục chạy.
- Đã kiểm tra screenshot desktop/mobile 390px và không tràn ngang. Ảnh được tạo tại `client/test-results/m4-*.png`.
- Giới hạn phiên 2.000 readings và 2.000 sensors, trang 100; không tự tải hàng trăm nghìn điểm. Số đo geometry 2.000 điểm: 1,70 ms trên máy phát triển; buffers vị trí+màu Float32: 48.000 bytes. Đây không phải số đo tổng heap/GPU hoặc FPS trên thiết bị mục tiêu. Cần đo lại trước khi nâng giới hạn. Không cắt bớt âm thầm tập readings đã tải.
- Build bổ sung có placeholder public token để kiểm tra nhánh bundling Mapbox/CSS đạt; không dùng token này gọi dịch vụ thật. Mapbox lazy chunk khoảng 1.892 KB minified / 529 KB gzip.
- Three.js lazy chunk khoảng 743 KB minified / 188 KB gzip, build có cảnh báo kích thước; không tải trên màn login/datasets.

## Chưa nghiệm thu thật

Backend thật và public Mapbox token hợp lệ chưa có trong môi trường kiểm tra. Chưa xác minh tiles/click/camera Mapbox với dịch vụ thật, biên from/to phía Server, hoặc ngân sách tổng memory/FPS trên thiết bị mục tiêu. Đây là các phần nghiệm thu còn chờ, không thay bằng mock. Không thay contract, Backend, PWA, Offline/Sync hoặc triển khai M5/M6.

Nguồn API renderer: [Mapbox layers](https://docs.mapbox.com/mapbox-gl-js/guides/styles/work-with-layers/), [Map API](https://docs.mapbox.com/mapbox-gl-js/api/map/), [Three OrbitControls](https://threejs.org/docs/pages/OrbitControls), [Raycaster](https://threejs.org/docs/pages/Raycaster).
