# Spatiotemporal Anomaly System

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

Frontend online đã có các màn hình đến M7 theo báo cáo kiểm chứng: từ root dùng `npm ci`, sau đó `npm run dev:mock`
để xem giao diện nền với dữ liệu mô phỏng tại `http://127.0.0.1:5173`.
`npm run dev` dùng transport API online. Backend B2 đã có health, Register/Login, current user và datasets list thật;
chạy bằng `npm run dev:server`, xem [server/README.md](server/README.md).
Luồng FE M2 đã được E2E với Backend/DB thật; import/query/analysis/review/admin CRUD còn tiếp tục ở B3 trở đi.

Xem [client/README.md](client/README.md) để cấu hình, build và kiểm thử;
[kế hoạch frontend](docs/frontend-online-plan.md) và
[bằng chứng M7](docs/frontend/m7-verification.md) để theo dõi phạm vi đã hoàn thành.

Backend B2: xem [kết quả kiểm chứng](docs/backend/b2-verification.md). Cần JWT secret trong env;
xem hướng dẫn seed tài khoản demo trong server README, không có password mặc định.
`npm run check` hiện kiểm tra cả client và server; kiểm thử MongoDB thật dùng
`npm run test:server:integration`; E2E B2 thật chạy bằng `npm run test:e2e:b2`.
