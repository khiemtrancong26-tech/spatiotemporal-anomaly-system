# Mapbox layout — 15/11/2026

Theo bố cục đã được người dùng chốt. Chỉ presentation và UI đóng/mở; giữ nguyên heatmap, timeline, maxAge, data/query/crossfade/camera.

## Thay đổi

- Header dataset gọn hơn; giữ breadcrumb, tên dataset và tabs. Thông tin thiếu metadata vẫn hiển thị đúng, không giả metadata.
- Một toolbar cho mode, thời gian, trước/sau, play/pause, slider, maxAge và ngày giờ/chi tiết. Tablet đưa slider xuống hàng riêng; mobile wrap theo nhóm, giữ accessible label và keyboard focus.
- Map cao `clamp(520px,65dvh,780px)` trên desktop, tối thiểu 520px trên mobile. Trong ảnh 1440×1000, mép trên canvas ở y≈349px, cao 650px. Gỡ các hàng legend bên dưới và các tiêu đề/khung lặp.
- Overlay trong map: thời gian/số trạm/loading/error ở trên trái, heatmap toggle trên phải, hai legend PM2.5 và cường độ thị giác dưới trái, reset camera dưới phải cạnh navigation. Legend có thể thu gọn. Inspector vẫn mở theo thao tác chọn hoặc nút Chi tiết & lớp; mobile đặt phía dưới map, không kéo legend khỏi canvas.
- Dock dữ liệu bổ trợ thu gọn mặc định; Xem bảng dữ liệu mở đúng tab readings và cuộn đến dock. Giữ tabs readings/heatmap thời gian/trạm/hướng dẫn và nội dung mounted; không tạo lại renderer khi mở bảng/legend.
- Không thêm layer roads/boundaries hoặc các ngưỡng/nhãn sức khỏe trong ảnh tham khảo. Màu và lời giải thích hai legend giữ đúng semantics đã chốt.

## Bằng chứng giữ nguyên logic

Đã lưu SHA-256 trước khi chỉnh layout và đối chiếu sau: `renderer.tsx`, `map-heatmap.ts`, `snapshot.ts`, `heatmap.tsx`, `heatmap-data.ts` không thay đổi byte nào trong lượt này. Các thay đổi chưa commit của đợt heatmap trước vẫn được giữ trong working tree. Trong visualization.tsx chỉ sắp xếp markup và thêm UI disclosure cho dock; các hooks lấy dữ liệu, timeline, scale, selection và handler của heatmap giữ nguyên.

## Kiểm chứng

- Typecheck/lint/build đạt; 92 unit/integration tests và 23 E2E đạt.
- E2E cập nhật thao tác mở bảng theo UI mới, giữ assertions cũ về dữ liệu, cursor, scope/time/maxAge/playback/selection và lỗi. Có thêm kiểm tra bảng đóng mặc định, mở bằng Enter không đổi canvas, map cao ≥520px và xuất hiện trong nửa trên viewport desktop.
- Mapbox thật + 12 trạm fixture riêng qua HTTP interception: style/tiles/heatmap tải thành công, 0 page errors; xác minh 3 overlay nằm trong bounds canvas. 1440×1000, 1024×900, 390×844 không tràn ngang toàn trang. Đây là dữ liệu kiểm thử, không ghi vào ứng dụng/database.
- [Desktop](map-layout/desktop.png), [khung tiếp theo](map-layout/frame-next.png), [tablet](map-layout/tablet.png), [mobile](map-layout/mobile.png), [mobile mở inspector](map-layout/mobile-inspector.png). Đã kiểm tra mở inspector không tạo lại canvas và legend vẫn nằm trong canvas. Ảnh trước bố cục mới xem [heatmap/timeline](heatmap-timeline/desktop.png).
- Cổng kiểm thử riêng 5273/4273 và 5276; không dùng/dừng server của người dùng. Không commit/push.

Files của lượt layout: `client/src/features/workspace/visualization.tsx`, `client/src/app/styles.css`, `client/e2e/{foundation.spec.ts,online.spec.ts}`, client README và báo cáo/ảnh này. Không đổi Backend/API/database. Không đo lại FPS/GPU với dữ liệu lớn; các giới hạn dữ liệu/trang trước đây giữ nguyên.
