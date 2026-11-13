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

Frontend M1 đã chạy được: từ root dùng `npm ci`, sau đó `npm run dev:mock`
để xem giao diện nền với dữ liệu mô phỏng tại `http://127.0.0.1:5173`.
`npm run dev` dùng transport API online; Backend trong checkout chưa được khởi tạo.
Các chức năng nghiệp vụ frontend sẽ triển khai từ M2, chưa phải MVP hoàn chỉnh.

Xem [client/README.md](client/README.md) để cấu hình, build và kiểm thử;
[kế hoạch frontend](docs/frontend-online-plan.md) và
[bằng chứng M1](docs/frontend/m1-verification.md) để theo dõi phạm vi đã hoàn thành.
