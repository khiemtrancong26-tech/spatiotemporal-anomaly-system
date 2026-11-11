
# Technical Decisions

## Các quyết định đã thống nhất

| ID | Quyết định | Lý do |
|---|---|---|
| D001 | Sensor Data, MVP PM2.5 | Giới hạn phạm vi dữ liệu |
| D002 | Full-stack TypeScript | Thống nhất ngôn ngữ |
| D003 | MongoDB là Database chính | Đáp ứng yêu cầu môn học |
| D004 | Mapbox 3D + Three.js Cube | Hai góc nhìn không gian – thời gian |
| D005 | Thống kê online/offline, ML chỉ online | Phù hợp khả năng Client–Server |
| D006 | Không triển khai LLM trong MVP | Kiểm soát phạm vi |
| D007 | npm workspaces | Quản lý Monorepo chung |

## Quyết định chưa hoàn tất

- Mongoose hay MongoDB official driver.
- Thuật toán ML cuối cùng.
- Redis: chỉ bổ sung nếu cần thiết.

## Mẫu ghi quyết định mới

### DXXX — Tên quyết định

- Ngày:
- Vấn đề:
- Phương án chọn:
- Lý do:
- Ảnh hưởng:
- Người thống nhất:
