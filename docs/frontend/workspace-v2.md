# Workspace v2 — bản đồ cùng thời điểm và sửa UX

Ngày 15/11/2026. Theo phản hồi trực tiếp của chủ dự án khi demo file Beijing thật. Thay thế mixed-time latest-per-station và việc selected reading thay thế điểm trạm ở M4 ban đầu. Không đổi Backend/endpoints/OpenAPI/Shared Data Contract, auth, analysis polling hoặc review semantics.

## Cơ sở tham khảo

Đã đọc `C:/torontopulse/src/App.tsx`, `components/MapContainer.tsx`, `components/DashboardPanel.tsx`, `index.css`. Áp dụng cách bản đồ chiếm vùng chính, panel có giới hạn chiều cao/thu gọn, điều khiển lớp và chi tiết độc lập. Giữ React/Mapbox/Three hiện có và light design tokens; không thêm dependency. Không sửa repo Toronto Pulse.

## Logic bản đồ hiện tại

- Chọn thời điểm T. FE gọi GET readings với dataset/sensorId/bbox và `from=T`, `to=T`, sort `ts:asc`, limit 100. D013 hỗ trợ biên đóng/from=to; không cần API mới.
- Tự đọc các cursor tại đúng T, độc lập trang readings theo thời gian của Cube/bảng. Chỉ công bố frame khi đọc xong; nếu trang sau lỗi, không công bố phần trước như một frame đầy đủ. Không giữ điểm của T cũ khi đang tải T mới hoặc lỗi.
- Kiểm tra response khớp dataset/time/sensor, không lặp station/time, không lặp cursor hoặc trang không tiến triển. Giới hạn 2.000 trạm; nếu còn cursor hiển thị rõ chưa đủ và cần thu hẹp phạm vi.
- Chỉ trạm có mẫu đúng T. Không chọn số đo gần nhất, carry-forward hoặc nội suy. Trước/Sau theo danh sách thời điểm đã tải, có nhập ngày giờ UTC+07 trong phạm vi filter để đọc T bất kỳ.
- Bấm điểm/Chọn dòng chỉ mở inspector. Khi xem reading khác T, panel ghi rõ nó khác thời điểm bản đồ; không bỏ các trạm khác hoặc đổi frame âm thầm. Có dropdown trạm tại T để inspect bằng bàn phím, kể cả trạm chưa có trong trang readings theo thời gian.
- Mapbox data/highlight/heatmap cập nhật qua sources/layer trên cùng instance, camera giữ nguyên khi đổi T/selection/pagination. Cube cập nhật buffer theo dữ liệu/highlight, không tạo lại camera/controls khi chọn dòng hoặc tải thêm. Rời mode/dataset vẫn cleanup.
- Heatmap không gian gộp đúng các điểm của frame, ô 0,02°, cùng scale PM2.5 đã tải; không tạo vùng dữ liệu giả. Thang màu ghi rõ dữ liệu tham chiếu đã tải, không phải ngưỡng sức khỏe. Công trình 3D dùng composite building layer của Mapbox khi style có source, ở zoom >=14; không phải số đo PM2.5.
- Beijing full đã xác minh có 41.757 readings nhưng 1 sensor. Đổi logic không biến dữ liệu đó thành nhiều trạm. Metadata/số mẫu thiếu không được bịa để làm bản đồ dày hơn.

## UX đã sửa

- Rail điều hướng gọn trong Workspace, header/dataset title nhỏ hơn, canvas lớn theo viewport; Mapbox mặc định khi có token, Cube fallback mặc định khi không có token.
- Filter popover đóng mặc định, tự đóng khi áp dụng; Escape/click ngoài đóng. Không để panel mở mặc định chặn nút Mapbox như lần E2E đầu đã phát hiện.
- Inspector nổi trên desktop và thành panel riêng dưới map trên mobile, có Đóng; không che toàn bộ bản đồ trên điện thoại.
- Status tách số trạm frame / readings đã tải / tổng dataset nếu metadata có. Nút tải tiếp ngay đầu vùng chính và toolbar bảng, không nằm sau hàng trăm dòng.
- Bảng chỉ cao tối đa 340px (mobile 300px), sticky header, số đo theo cột dễ đọc. Nút ngắn Xem chi tiết, accessible name vẫn giữ reading ID. ID kỹ thuật chuyển sang cột phụ.
- Tab bổ trợ Bảng readings / Heatmap thời gian / Trạm / Hướng dẫn; nội dung không hoạt động ẩn bằng hidden, không đẩy thành một trang dài. Các tab panel có thể dùng bàn phím và vùng cuộn focus được.
- Import: label tiếng Việt kèm tên field/hint, cảnh báo nguồn tách year/month/day/hour, chi tiết lỗi thu gọn với vùng cuộn riêng. Không sửa mapping request hoặc tự đoán dữ liệu thiếu.

## Kiểm chứng

- Typecheck/lint/86 unit & integration tests (13 files) đạt; production build có/không token đạt.
- 22 E2E Chromium đạt trên cổng riêng 5175/4175 để giữ nguyên dev server người dùng tại 5173. Bao gồm regression auth/import/analysis/ML/review/admin.
- Test nhiều trạm: readings theo thời gian chỉ có trạm A; frame T đọc hai trang cho A+B. Chọn B vẫn giữ 2 trạm, chọn reading A khác T chỉ đổi inspector; bước Sau tải A+B tại T mới. Kiểm tra chiều cao bảng và không tràn ngang ở 390px.
- Unit: pagination đầy đủ tại đúng T, không mix dataset/time, cap 2.000 và remaining flag, trang sau lỗi không công bố partial, response cũ bị bỏ/abort, repeated cursor. Mock Mapbox xác minh tất cả features còn sau selection, đổi T không tạo instance/fit camera lại, cleanup khi unmount.
- Fixture của test M4 cập nhật để trả đúng from=to cho query mới; giữ assertions selection/cursor/filter/fallback. Test UI thêm thao tác mở filter/tab tương ứng bố cục mới, không xóa assertions để che lỗi.

## File chính

`client/src/features/workspace/{page.tsx,visualization.tsx,renderer.tsx,snapshot.ts,snapshot.test.ts,renderer.test.tsx}`, `client/src/app/{shell.tsx,styles.css}`, `client/src/features/dataset-import/page.tsx`, `client/e2e/{foundation.spec.ts,online.spec.ts}`, `client/playwright.config.ts`. Tài liệu client README, frontend plan/M4 report/UI redesign được cập nhật chính sách hiện tại.

## Giới hạn

Frame có nghĩa là cùng timestamp, không phải MongoDB snapshot isolation giữa các HTTP requests. Nếu vượt 2.000 trạm phải thu hẹp phạm vi, không quảng cáo đã tải đủ. UI test nhiều trạm dùng HTTP interception và renderer mock để xác minh danh sách points; không thay thế đo FPS/GPU với nhiều nghìn trạm trên thiết bị mục tiêu. Dữ liệu online/người dùng vẫn là dữ liệu thật. Không commit/push hoặc dừng dev server người dùng.


## Ảnh kiểm tra v2

Bộ ảnh dùng **3 trạm mô phỏng chỉ trong browser QA/HTTP interception**, có tên dataset ghi rõ QA; nền/tiles Mapbox tải thật. Không ghi vào Backend hoặc dataset Beijing của người dùng. Script: `client/scripts/capture-workspace-v2.mjs`, chạy với preview QA riêng; kiểm tra cả 1440px và 390px không tràn ngang toàn trang.

- [Mapbox desktop](workspace-v2/map-1440.png), [mobile](workspace-v2/map-390.png).
- [Vùng map desktop](workspace-v2/map-stage-1440.png), [vùng map mobile](workspace-v2/map-stage-390.png): cả ba trạm cùng T đều nằm trong viewport; khi đổi chiều rộng, map fit lại phạm vi thay vì để các trạm ra ngoài màn hình. Thay đổi selection/time không fit lại camera.
- [Cube + heatmap desktop](workspace-v2/cube-heatmap-1440.png), [mobile](workspace-v2/cube-heatmap-390.png).
- [Import/mapping desktop](workspace-v2/import-mapping-1440.png), [mobile](workspace-v2/import-mapping-390.png).

Đã xem ảnh và sửa lỗi pseudo-element mobile bị xoay cả chữ, inspector che map trên mobile, popover che nút, và fit bounds khi đổi chiều rộng. Unit 86/86, E2E 22/22, typecheck/lint/build cuối đạt. Build có token và không token đều đạt; còn cảnh báo chunk Three.js/Mapbox lớn và TanStack CLI như trước. Preview QA được dừng sau khi chụp; không chiếm hoặc dừng server người dùng. Cuối lượt xác nhận các cổng 5173/5175/4175/4177 đều trống.
