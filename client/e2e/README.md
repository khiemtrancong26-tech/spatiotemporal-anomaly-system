# Kiểm thử frontend trên trình duyệt

> Playwright mở ứng dụng trên Chromium Desktop và thao tác như người dùng. Các kịch bản online tại đây mô phỏng phản hồi HTTP để tái lập lỗi và trạng thái nghiệp vụ.

## Mở file nào

- Kiểm tra luồng tài khoản, workspace và admin ở chế độ mock. [`mock-application-workflows.spec.ts`](mock-application-workflows.spec.ts)
- Kiểm tra session, import, phân trang, Analysis, review và admin qua API mô phỏng. [`online-api-workflows.spec.ts`](online-api-workflows.spec.ts)
- Kiểm tra khám phá dữ liệu, phạm vi Analysis và điều tra bất thường. [`analyst-exploration-and-review.spec.ts`](analyst-exploration-and-review.spec.ts)
- Kiểm tra các chế độ và giới hạn hiển thị của Cube. [`space-time-cube.spec.ts`](space-time-cube.spec.ts)
- Kiểm tra chia sẻ lựa chọn, thời gian và dữ liệu giữa Mapbox và Cube. [`map-cube-state-sharing.spec.ts`](map-cube-state-sharing.spec.ts)
- Định nghĩa các project browser và cách khởi động server test. [`../playwright.config.ts`](../playwright.config.ts)
