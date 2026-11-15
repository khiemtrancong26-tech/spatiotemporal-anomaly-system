# Heatmap mềm và timeline có giới hạn độ cũ

Ngày 15/11/2026. Chỉ frontend visualization và tài liệu liên quan; không đổi Backend, API Contract/database hoặc heatmap ngày × giờ.

## Hành vi

- Thay polygon/grid bằng hai Mapbox heatmap layer để hòa chuyển; giữ nền light-v11. Radius theo zoom 40–260px, intensity 1–2,2, opacity chủ đạo 0,78 và giảm dần khi zoom gần. Palette teal → green → yellow → orange → red → purple, density 0 trong suốt. Circle tăng kích thước/độ rõ theo zoom, nhãn giá trị từ zoom 13; popup dùng value/timestamp thực của DTO và DOM text an toàn.
- Tại T, FE gọi readings hiện có với `from=max(T-maxAge, bộ lọc from)`, `to=T`, sort ts:desc. Đọc các trang rồi chọn một mẫu mới nhất mỗi sensor; nếu cùng timestamp thì tie-break bằng ID. Không tự thay mẫu bằng reading đang chọn trong bảng, không lấy mẫu tương lai. Biên độ cũ đóng: đúng 2 giờ vẫn giữ, quá 2 giờ không hiển thị. Mặc định 2 giờ, UI cho chọn 0,5/1/2/4/6/12/24 giờ.
- Ngân sách tối đa 2.000 readings/cửa sổ (không phải 2.000 trạm). Khi còn cursor thì báo số trạm chưa đầy đủ và không phát tự động. Request lỗi không công bố phần dữ liệu dở; giữ nguyên khung trước và ghi rõ trong UI. Response trễ bị bỏ qua; không thay state/filter của Cube hoặc bảng.
- Slider và Trước/Sau theo các timestamp thật trong readings đã tải; vẫn có nhập ngày giờ UTC+07. Phát chờ khung tải xong, giữ 1,8 giây rồi chuyển; không gửi request liên tục theo animation. Dừng tại cuối, lỗi, còn trang hoặc tab ẩn; đổi mode/maxAge và thao tác thời gian chủ động tạm dừng.
- Khi worker Mapbox báo source mới sẵn sàng, hai lớp heatmap crossfade 700ms. Source cũ giữ hình ảnh trong lúc chuẩn bị khung mới. Không tạo lại map/camera khi đổi thời gian hoặc chọn reading. Bỏ listener/popup/source transition khi unmount; reduced motion dùng duration 0. Đây là hòa trộn hình ảnh, không nội suy vị trí, giá trị hoặc timestamp của readings.
- Màu circle và legend số vẫn là PM2.5 thật theo thang đã tải. Heatmap có legend **cường độ thị giác tương đối** riêng, phụ thuộc PM2.5, mật độ trạm và zoom; không gắn nhãn Tốt/Xấu hoặc khẳng định nồng độ tại mọi vị trí. Viền anomaly trên circle giữ nguyên.

## Kiểm chứng

- Typecheck/lint/production build và 92 unit/integration tests đạt. Kiểm tra cửa sổ, maxAge, mẫu tương lai/quá cũ, boundary 2 giờ, newest/tie-break, cursor budget/race, giữ khung cũ khi lỗi; layer heatmap thay fill, bảo toàn instance/camera; popup timestamp thực; chờ source-ready trước fade/cancel/cleanup/reduced motion.
- E2E **23/23 đạt**, kiểm tra paging cửa sổ, selection không đổi khung, timestamp thực của trạm được carry-forward, loại mẫu quá cũ, cấu hình maxAge, play/pause và mobile không tràn ngang. Các bài cũ chỉ đổi fixture/assertion tương ứng tính năng đã được người dùng đổi (from=to và grid); không bỏ kiểm tra lỗi/kết quả.
- Dùng cổng riêng 5273/4273 và token rỗng trong tiến trình E2E fallback để không chiếm hoặc dừng dev server của người dùng. Screenshots do Playwright tạo tại `client/test-results/heatmap-timeline-{desktop,mobile}.png`.

## Giới hạn và nguồn

Test dữ liệu/API dùng HTTP interception. Đã chạy bổ sung Mapbox thật với 12 trạm/24 readings thử: style/tiles và heatmap tải thành công, 0 page errors, đã xem hai khung và mobile 390px không tràn ngang. [Desktop](heatmap-timeline/desktop.png), [khung tiếp theo](heatmap-timeline/frame-next.png), [mobile](heatmap-timeline/mobile.png). Dữ liệu của ảnh là fixture riêng trong trình duyệt kiểm tra, không ghi vào online code/database; không phải đo trên dataset thật của người dùng. Lifecycle/source-ready/crossfade chi tiết vẫn kiểm tra bằng mock; chưa đo FPS/GPU định lượng. Giới hạn mẫu/trang được ghi rõ. Không tạo raster dự báo/IDW hay giả lập kết quả online.

Tham chiếu chính thức: [Mapbox heatmap example](https://docs.mapbox.com/mapbox-gl-js/example/heatmap-layer/), [style specification](https://docs.mapbox.com/style-spec/reference/layers/#heatmap). Heatmap sử dụng weighted point density; việc chuyển màu là biểu diễn trực quan.

Files: `client/src/features/workspace/{visualization.tsx,renderer.tsx,snapshot.ts,map-heatmap.ts}` và tests tương ứng; `client/src/app/styles.css`; E2E foundation/online, client README và các ghi chú FE. Không commit/push.
