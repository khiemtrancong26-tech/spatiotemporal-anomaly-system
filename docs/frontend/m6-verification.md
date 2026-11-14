# M6 — Anomaly list/detail/review

Ngày 14/11/2026. Frontend online; chưa triển khai Backend hoặc offline review.

- Tab Anomalies đọc list qua adapter với dataset/run/family/method/severity/status/from/to, sort/cursor; không gửi sensorId/bbox. Giới hạn phiên 2.000, trạng thái loading/error/empty và tải thêm có kiểm soát.
- GET chi tiết kiểm tra ID/dataset, hiển thị reading/sensor/run, tọa độ/thời gian, detector/score/severity/status/version/updatedAt. Không tự bịa giá trị reading hoặc endpoint lookup reading.
- PATCH chỉ baseVersion + changes status/note. Giữ draft khi lỗi; success chỉ sau response hợp lệ. Sau lưu refresh list và cập nhật chi tiết/metadata anomaly trong workspace.
- 409 khóa lưu, giữ draft, GET bản Server; GET lỗi có đọc lại. Người dùng chọn bỏ draft hoặc giữ draft trên version mới rồi chủ động Lưu. Không tự merge/ghi đè/retry mutation.
- Cảnh báo rời route/reload/đổi tab/filter khi draft chưa lưu. Nút về danh sách yêu cầu xác nhận bỏ draft. Review chưa lưu không chuyển thẳng sang renderer.
- Chọn reading qua workspace; nếu chưa có trong phần readings đã tải, M4 hiển thị thông báo. Mock review có CAS trong RAM, không phải persistence thật.

Kiểm chứng: `npm run check` (typecheck/lint/75 tests/build); E2E HTTP interception kiểm tra 409 giữ draft, đọc bản Server, rebase chủ động, payload chỉ review fields và lưu version mới; regression M2–M5 chạy cùng suite. Mock/HTTP interception không chứng minh CAS giữa hai phiên Backend thật; nghiệm thu Server còn chờ.

Kết quả cuối: 15/15 E2E đạt (M2–M6), gồm lỗi mạng giữ draft, chặn đổi tab khi từ chối bỏ draft, hai cách xử lý conflict, payload/version đúng. Đã sửa mount Anomalies thoáng qua khi workspace chưa khởi tạo để không query kết quả sớm ở M5. Lint và diff check đạt; desktop screenshot đã xem, viewport 390px không tràn ngang.
