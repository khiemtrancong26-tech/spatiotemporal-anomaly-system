# Analyst UX v1 — bàn giao

Ngày 16/11/2026. Theo `../PM25_Analyst_UX_Handoff/PM25_Analyst_UX_Handoff.md`. Bốn phần được triển khai trong checkout hiện tại, chưa commit/push hoặc tạo PR.

## Phạm vi và mapping

| Phần | File chính | Nguồn dữ liệu / hành vi |
|---|---|---|
| Exploration | `workspace/exploration.tsx`, `exploration-chart.tsx` | Profile cho KPI/quality; Aggregates cho mean/count/coverage. Ba series mặc định, tối đa 20, hour/day, null ngắt đường và giữ điểm đơn lẻ. Bảng và small multiples trong disclosure. CTA chọn scope workspace hoặc trạm chart, chưa POST. |
| Analysis | `analysis/page.tsx`, `intent.ts`, `results.tsx` | Ba bước scope/method/confirm, Profile kiểm scope đúng trước khi công bố count; chặn count biết >50k. Preset cố định, không gửi bbox. Snapshot/key lưu trước POST; retry chủ động cùng body/key trong 24h. History và results gắn run, polling 3s/backoff tối đa 30s. JSON chỉ trong disclosure. |
| Investigation | `workspace/investigation.ts`, `state.ts`, `page.tsx` | Xác minh đúng dataset/sensor/readingId/ts bằng query chính xác, có pagination và cap 2k. Mở đúng reading trước, cho chủ động mở rộng ±12h/trạm xung quanh. Quay lại giữ run, selection, query, pages và list DOM. |

Các tên file trên tương đối với `client/src/features/`. Helpers dùng chung: `workspace/analyst.ts`, `analyst-ui.tsx`. CSS mới có scope `.analyst-ux`/`.workspace-analyst`, không áp vào Visualization thông thường.

## Giữ nguyên ranh giới

Không đổi backend production (`server/src`), OpenAPI, shared DTO hoặc thêm dependency. Không thay renderer, geometry, camera, palette PM2.5, heatmap hoặc snapshot policy. `visualization.tsx` và `cube-explorer.tsx` chỉ nhận trạng thái khởi tạo đã xác minh và nối navigation/review; không đổi JSX layout hoặc engine. Xem `protected-files.json` để đối chiếu SHA-256 các file được giữ nguyên.

## Bằng chứng kiểm chứng

- Root `npm run check`: typecheck/lint/test/build của client, server và shared-core. Unit/integration mặc định: client **106**, server **66**, shared-core **7**.
- Client Playwright: **33** cases, gồm 6 cases Analyst mới: Profile/aggregate/gaps; scope handoff không POST; replay sau reload; cap50k; exact reading/return/draft; missing reading; responsive (một số case gộp nhiều nhánh).
- Backend browser suite: **4/4 passed** — B5 statistical, B6 CSV/review hai client, Analyst journey và C2 Profile/Aggregates/timezone. Không HTTP intercept trong các case này. MongoDB Replica Set tạm, tài khoản/dataset kiểm thử riêng; không ghi dữ liệu vào database người dùng.
- Analyst journey import CSV thật 8.782 readings, kiểm coverage unknown khi thiếu sampling metadata; mean 86,55 và chart 3 series từ API. Tắt socket sau acceptance commit, reload/replay cùng key/body, kiểm DB chỉ có một run. Z-score chạy thật, reading Nongzhanguan 369 được tra đúng ID, điều tra Cube/Mapbox frame, quay lại đúng run rồi lưu review; score/method không đổi.
- B6 concurrency case: client B ghi v2; client A nhận 409, giữ note, chủ động rebase/lưu v3; reload xác nhận trạng thái/note/version.

Ảnh `before/` từ code HEAD `03dc4f8` được xuất vào thư mục tạm; ảnh `after/` từ code mới. Cả hai dùng cùng Backend/CSV thật trong harness. Các ID trong ảnh thuộc database kiểm thử đã được hủy, không phải production.

## Xem ảnh

- `before/01-exploration-{1600,390}.png` → `after/01-exploration-{1600,1024,390}.png`
- `before/02-analysis-setup-*.png` → `after/02-analysis-setup-*.png`
- `before/03-analysis-completed-*.png` → `after/03-analysis-completed-*.png`
- `before/04-anomalies-review-*.png` → `after/04-anomalies-inspector-*.png`, `after/06-review-*.png`
- `after/05-investigation-cube-*.png`: navigation mới ở ranh giới workspace; Cube giữ UI hiện có.

## Chạy lại

Từ root: `npm run check`.

Client E2E cần build fallback riêng, không sửa `.env.local`:

```powershell
cd client
$env:VITE_MAPBOX_TOKEN=''
npm run build
$env:PM25_E2E_MOCK_PORT='5273'
$env:PM25_E2E_ONLINE_PORT='4273'
npx playwright test --workers=2
```

Backend E2E từ `server`: `npx playwright test --config playwright.config.ts statistical-analysis.spec.ts anomaly-review.spec.ts dataset-exploration.spec.ts --grep-invert "Analyst journey:"`. Có thể đặt `MONGOMS_SYSTEM_BINARY` đến mongod local để tránh tải binary; phiên kiểm tra này dùng MongoDB 9.0.4 với Replica Set tạm. Nếu dùng binary khác version mặc định của harness, đặt `MONGOMS_SYSTEM_BINARY_VERSION_CHECK=false` và ghi lại version thực tế. `PM25_UX_BASELINE_ROOT` là tùy chọn để chụp baseline từ một bản export HEAD riêng.

Không chạy generate/build song song với browser E2E dùng Vite dev: thay đổi generated files có thể gây HMR/reload giữa wizard và làm mất xác nhận mapping. Chạy tuần tự. Cuối cùng build thông thường trong shell không có override Mapbox token.

## Giới hạn

Mapbox handoff kiểm timestamp, snapshot và selected reading với token rỗng trong harness; không dùng kết quả này để khẳng định tiles/GPU/FPS đã nghiệm thu. Không thêm export/cancel/forecast/retraining, detector mới hoặc API mới. Review confirmed chỉ là đánh giá của Analyst. Các cảnh báo chunk size và circular dependency của công cụ generate vẫn tồn tại; không cản build.

Bản export baseline tạm `.local/analyst-ux-before-61mnc2ho` vẫn được giữ vì cơ chế duyệt lệnh từ chối thao tác dọn thư mục. Thư mục nằm trong `.gitignore`, không thuộc thay đổi bàn giao; junction `node_modules` bên trong trỏ đến dependencies của repository.
