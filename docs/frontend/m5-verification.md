# M5 — D008 migration và Analysis online

Ngày 14/11/2026. Phạm vi frontend online + shared contract; không triển khai Backend/worker/queue/engine hoặc Offline/Sync. Không commit/push.

## Migration đã hoàn thành

- Shared-core có dependency Zod trực tiếp, status queued, scope bắt buộc và validation terminal: completed/failed có completedAt, chỉ failed có error. Tests đối chiếu cả Zod và OpenAPI. IQR thêm multiplier cố định 1.5 theo D009; không viết engine.
- Generator hiện có tự phát hiện GET detail; đã regenerate 20 online operations / 33 schemas. Không cần sửa lại thuật toán generator. Adapter `analysis.create` trả `{data}`, `analysis.get` unwrap run, history giữ pagination. Không còn đọc anomalies từ response POST.
- Guard fixture audit chuyển 19 → 20; mock có tiếp nhận/replay snapshot queued, GET progression và results gate. Đây là mô phỏng RAM, không thể chứng minh durability/concurrency/engine thật; reload mất run demo mới.

## M5 đã triển khai theo xác nhận của người dùng

- Presets thật: statistical/zscore `{threshold:3}`, statistical/iqr `{multiplier:1.5}`. Không chỉnh tham số. Isolation Forest hiển thị nhưng khóa gửi riêng ML do chưa có method/config API. Server kiểm tra điều kiện dữ liệu và trả lỗi; FE không tự đặt số mẫu/variance/severity.
- Snapshot dataset/trạm/from/to bất biến khi submit, key UUID và snapshot giữ trong sessionStorage theo mode/user/dataset. Bbox chặn gửi theo lựa chọn đã chốt. Không dùng tập readings đang render làm input. Logout/401 xóa ngữ cảnh cùng phiên.
- Online POST mới được gửi, nhưng nếu mất phản hồi thì khóa retry vì retention thật chưa chốt; không tự đổi key. Mock hỗ trợ retry cùng key/payload trong 15 phút. Nhận ID thì theo dõi bằng GET; tạo lần chạy mới là hành động chủ động có xác nhận.
- Run ID trong URL `?runId=...`; restore/login/reload đọc lại run. History sort/cursor, nút làm mới và giới hạn phiên 2.000 runs. Poll 3 giây khi hiện, lỗi backoff có jitter tối đa 30 giây, tab ẩn tạm dừng; không overlap, bỏ response trễ và dừng khi terminal/logout/rời màn. 401/403/404 ngừng poll tự động, có đọc lại chủ động. Timeout request 20 giây không hủy job Server.
- Tách kết nối theo dõi khỏi status Server; giữ status gần nhất khi GET lỗi. Failed hiển thị code/message; completed mới tải anomalies theo run, cursor 100/trang, giới hạn phiên 2.000 có nhãn. Kết quả rỗng chỉ báo khi GET thành công.
- Kết quả nối tab Anomalies và lớp đánh dấu reading tím trên Mapbox/Cube; phạm vi run độc lập filters xem. Chọn anomaly đi đến reading nếu đang tải; thiếu reading có thông báo, không tự tải cả dataset. Review editing vẫn thuộc M6.
- Workspace vẫn lọc/chuyển renderer trong lúc job xử lý. Rời Analysis dừng theo dõi phía Client, không gửi hủy job. Scope/config hiển thị từ run Server, không lấy filter đang xem thay thế.

## Kiểm chứng

- `npm run check`: typecheck/lint + 75 tests / 10 files + production build đạt.
- `npm run test:e2e`: 13 tests đạt, gồm M2–M4 regression và M5: demo submit/lifecycle/logout; queued/running/network-error/reload/completed; failed không gọi results; completed rỗng; payload zscore/iqr đúng; unknown online POST giữ snapshot và không tự resend/retry sau reload; chọn kết quả sang visualization.
- Unit tests: shared/wire invariants, polling không overlap, backoff/terminal/visibility/dispose-late-response, replay-window và snapshot; mock replay cùng run và không công bố kết quả sớm.
- `python docs/frontend/verify_m0.py`: 38 cases / 20 operations / 7 core DTO / 7 legacy payloads đạt; không cần override guard trong bộ nhớ nữa.
- Desktop/mobile 390px đã xem ảnh; bảng cuộn ngang, không tràn viewport. Suite đầy đủ tạo ảnh ở `client/test-results/m5-desktop.png`, `m5-mobile.png`; đây là thư mục tạm được Playwright ghi đè ở lần chạy kế tiếp.

## Giới hạn nghiệm thu

E2E online dùng HTTP interception, demo dùng mock, không có Backend thật. Chưa chứng minh worker/queue, persistence/restart/idempotency retention, detector execution hoặc concurrency. ML chờ method/config API/model version; điều kiện dữ liệu và mã lỗi cụ thể chưa chốt. Không đánh dấu nghiệm thu ML/Backend thật xong. Build vẫn có cảnh báo Three.js chunk lớn như M4; không che cảnh báo bằng đổi ngưỡng.
