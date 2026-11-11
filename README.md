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

Đang hoàn thiện Monorepo Scaffold.
Chưa có ứng dụng có thể chạy.

Hướng dẫn cài đặt và chạy sẽ được cập nhật sau.
