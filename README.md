# Spatiotemporal Anomaly System

**B2-Email Extension:** Register có email bắt buộc, xác minh email trước Login cho tài khoản tự đăng ký mới; Forgot/Reset Password có thu hồi JWT cũ. Legacy/admin/seed giữ hành vi. [Thiết lập Gmail SMTP, kiểm chứng và demo](docs/backend/b2-email-verification.md). Mock email trả unavailable, không giả lập gửi thư.

Hệ thống phân tích và phát hiện bất thường trong dữ liệu không gian – thời gian bằng trực quan 3D.

## Phạm vi

MVP sử dụng dữ liệu cảm biến PM2.5 theo không gian và thời gian.

- Full-stack TypeScript
- MongoDB
- Statistical Anomaly Detection + ML Inference
- Mapbox 3D + Three.js Space-Time Cube
- PWA, Offline-first và Auto Sync

## Monorepo

- `client/`: React Frontend và Offline
- `server/`: Fastify Backend
- `shared-core/`: Shared Schema và Statistical Engine
- `infra/`: Docker, Nginx, HTTPS
- `tests/`: Kiểm thử
- `docs/`: Tài liệu

## Quy trình Git

- `main`: Phiên bản ổn định
- `develop`: Nhánh tích hợp
- Branch cá nhân/tính năng: Nơi phát triển độc lập
- Tích hợp bằng Pull Request

Xem `docs/ownership.md` để biết phân công.

## Trạng thái

Backend B1–B6/C2/C3 và luồng Frontend online đã có kiểm thử với API/MongoDB thật. Chạy `npm ci`, cấu hình `.env` và MongoDB Replica Set, rồi `npm run dev:server` + `npm run dev`. Setup tài khoản/runtime tại [server README](server/README.md); không có mật khẩu mặc định.

ML chỉ có **một Isolation Forest 3 features** `[value, temporal_delta, spatial_delta]`, artifact đã train offline tại C3. Frontend chọn Isolation Forest là gửi `config:{}`; không chọn phiên bản. Cần artifact đúng hash tại `.local/models/pm25-iforest-v2` hoặc `ANALYSIS_ARTIFACT`. Xem [demo và kiểm chứng pipeline một model](docs/backend/c3-single-model-verification.md) và [ML setup](server/ml/README.md). Không train lại trong request/Worker.

`npm run dev:mock` chỉ xem giao diện với dữ liệu mô phỏng. Mock ML chưa triển khai, trả503 rõ ràng; không tạo kết quả inference giả. `npm run check` kiểm type/lint/unit/build; `npm run test:server:integration` chạy MongoDB functional regression; `npm run test:e2e:c3` chạy Desktop E2E với model thật.

B7/Admin, C4 và B8/deployment/performance vẫn ngoài phạm vi task này. PWA/Offline/Sync là roadmap, không được suy thành đã nghiệm thu. Xem [client README](client/README.md), [kế hoạch Backend](docs/backend-online-plan.md), [decisions](docs/decisions.md).
