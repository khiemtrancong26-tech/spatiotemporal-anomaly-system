# Workspace và trực quan PM2.5

> Workspace giữ dataset đang xem, bộ lọc và dữ liệu đã tải. Tại đây analyst chuyển giữa khám phá số liệu, Mapbox, Space–Time Cube, Analysis và Anomalies.

## Mở file nào

- Ghép các tab và gọi Profile khi phạm vi tra cứu thay đổi. [`page.tsx`](page.tsx)
- Quản lý bộ lọc, lựa chọn và ngữ cảnh theo dataset. [`state.ts`](state.ts)
- Gọi dữ liệu tổng hợp theo trạm và thời gian cho biểu đồ. [`exploration.tsx`](exploration.tsx)
- Điều phối Mapbox và Cube, giới hạn phạm vi và tải readings. [`visualization.tsx`](visualization.tsx)
- Vẽ các lớp và tương tác trên Mapbox. [`renderer.tsx`](renderer.tsx)
- Điều phối chế độ khám phá và chọn điểm trong Cube. [`cube-explorer.tsx`](cube-explorer.tsx)
- Tái sử dụng các trang đã tải và theo dõi phạm vi dữ liệu hoàn chỉnh. [`readings-cache.ts`](readings-cache.ts)

Profile và biểu đồ tổng hợp có API riêng. Các trang readings phục vụ hiển thị được tải bằng cursor.
