# Kiểm toán hiệu năng backend

**18/11/2026 · `khiem/backend-database` · baseline `9e9eb67`**

## Môi trường và cách đo

Windows, Ryzen 5 5500U (6 core vật lý, 12 luồng), 16 GB RAM, Node 24.14.1, MongoDB 8.2.6/WiredTiger và k6 2.4.0 chạy cùng máy. Benchmark tạo replica set một node, database và thư mục nguồn riêng trong temp. WiredTiger có ngân sách cache 0,5 GiB. HTTP dùng Fastify bản build, JWT thật, kiểm tra account và ownership thật, logger mức `warn`. Fixture có 48.000 readings, 12 trạm, 24.000 anomalies và 5.760 readings trong scope của mỗi analysis job. Mỗi CSV nhập có 6.000 dòng.

Đo đọc với các bậc 4, 16, 40 và 100 VU, mỗi bậc 10 giây. Phép thử hỗn hợp kéo dài 30 giây, đặt lịch 240 lượt đọc/giây và gửi burst 16 VU PATCH, 6 upload, 6 import và 9 analysis job. Import dùng 6 nguồn đã upload và xác nhận mapping trước đó để đo admission độc lập. PATCH riêng dùng 32 VU, ghi các anomaly khác nhau cùng dataset, 15 giây cộng thời gian chờ hoàn tất request đang chạy. Mỗi bậc có thời hạn và điểm dừng khi RAM khả dụng xuống dưới 1,5 GiB hoặc CPU toàn máy duy trì từ 98% trong 30 giây.

## Phát hiện và thay đổi

| Nhóm | Bằng chứng và thay đổi |
| --- | --- |
| Upload, validation và import | Hai limiter toàn cục và ngưỡng validation cấu hình vô hiệu hóa việc tăng concurrency. Dùng capacity riêng theo Fastify instance. Upload từ chối sớm bằng `503 UPLOAD_CAPACITY` trước khi spool. Import có FIFO tùy chọn, giới hạn số chờ và deadline, hủy khi client ngắt trong lúc chờ, lấy slot trước khi claim idempotency key. Scan có giới hạn thực thi và chờ, với chỗ dự phòng cho các upload/import đã được nhận. Gom khóa dò trùng theo sensor với `$in` trên timestamp trong mỗi batch. |
| Datasets, sensors, readings | Explain dùng index hiện có. Deep cursor của readings đọc 101 khóa và 101 document cho 101 kết quả, gồm một bản ghi để xác định trang kế. Giữ projection, keyset và kiểm tra dataset/sensor hiện hành. |
| Analysis | Worker thức dậy khi job được nhận và khi có slot trống. Polling tiếp tục phục vụ recovery và job đến từ process khác. Statistical worker chỉ chuyển status, version và candidates cần cho bước publish. Python dùng FIFO có giới hạn thay cho vòng thử lại mỗi 25 ms. Driver, batch, thời gian chờ, context và giới hạn dữ liệu IPC có cấu hình tập trung. |
| Đọc anomalies | Thêm index `(datasetId, analysisRunId, ts, _id)`. Danh sách lọc theo run kiểm tra một run hoàn tất và một dataset có quyền trước khi truy vấn trang. Kiểm tra loại/phương pháp trong lookup diễn ra trước giới hạn trang. Explain của query thật xác nhận lookup anomalies đọc 101 khóa và 101 document và MongoDB gộp `$unwind` vào lookup. Ở baseline, phần lọc/sort đầu pipeline dùng 1.001 khóa/document cho cùng 101 kết quả. |
| Review | Hai transaction PATCH cùng dataset tranh chấp trên document dùng chung. FIFO cục bộ theo dataset giảm số transaction bắt đầu đồng thời trên fence đó. PATCH, sync review và nhận Analysis cùng chia sẻ FIFO trong app. Các transaction vẫn kiểm tra visibility, `baseVersion` và giữ cả hai fence. Khi hàng chờ đầy hoặc hết hạn, MongoDB tiếp tục xử lý với deadline của transaction, kể cả khi có nhiều process. |
| MongoDB | Tách các timeout selection/connect/socket/checkout, có thể override pool size và số kết nối mở đồng thời. `MONGODB_TIMEOUT_MS` là giá trị dự phòng cho bốn timeout. Các tham số pool trong URI tiếp tục có hiệu lực khi biến môi trường tương ứng bỏ trống. |

## Đối chiếu k6

Giá trị là một lượt đo cho mỗi bậc. Latency theo thứ tự p50 / p95 / p99, tính bằng ms.

| Đọc | Baseline req/s | Sau req/s | Baseline latency | Sau latency |
| --- | ---: | ---: | ---: | ---: |
| 4 VU | 200 | 448 | 7 / 68 / 83 | 8 / 17 / 20 |
| 16 VU | 381 | 521 | 32 / 114 / 137 | 28 / 52 / 59 |
| 40 VU | 346 | 446 | 95 / 244 / 293 | 81 / 150 / 183 |
| 100 VU | 290 | 492 | 308 / 610 / 724 | 188 / 342 / 411 |

Đợt 100 VU ngắn ghi nhận 0 lỗi HTTP đọc ở cả hai bản. Riêng danh sách anomalies theo run, p95 giảm từ 736 xuống 424 ms. Mức cao nhất quan sát trong bốn bậc là 521 req/s ở 16 VU. Các bậc cao hơn tăng thời gian chờ nhưng throughput dao động quanh vùng bão hòa. Pool 48 ghi nhận tối đa 47 kết nối checkout đồng thời, p95 checkout 26 ms và event-loop delay p99 63 ms, so với 24 ms và 133 ms ở baseline.

| Tải hỗn hợp 30 giây | Baseline | Sau |
| --- | ---: | ---: |
| Đọc HTTP 200 / 7.200 lượt đặt lịch | 5.808 | 6.983 |
| Upload / mapping thành công | 2 / 2 | 6 / 6 |
| Import hoàn tất / dòng đã công bố | 1 / 6.000 | 6 / 36.000 |
| Peak import / analysis chạy đồng thời, lấy mẫu | 1 / 1 | 3 / 3 |
| Analysis HTTP 202 / job hoàn tất | 7 / 8 | 9 / 9 |
| Trung vị chờ claim, giới hạn trên từ lấy mẫu | 6.745 ms | 2.905 ms |
| Analysis hoàn tất, trung vị DB | 7.096 ms | 4.949 ms |
| PATCH thành công | 225 | 480 |
| Từ chối do capacity | 9 | 0 |
| Lỗi hệ thống phía client | 4 | 0 |
| Write conflict MongoDB | 2.134 | 137 |

Baseline có 9 job được lưu. Hai POST vượt deadline client 15 giây và một job còn chạy khi kết thúc lấy mẫu. Bản tối ưu hoàn tất cả ba Z-score, ba IQR và ba Isolation Forest. Đọc hỗn hợp giảm p95 từ 274 xuống 198 ms cho readings và từ 522 xuống 287 ms cho danh sách anomalies. Các lượt đọc k6 chưa khởi chạy hoặc chưa hoàn tất được tính riêng với lỗi HTTP. Độ trễ event loop p99 hỗn hợp giảm từ 89 xuống 50 ms. RAM khả dụng thấp nhất lần lượt là 5,87 và 6,54 GiB. RSS lấy mẫu của Node là 445 và 449 MiB, của MongoDB là 316 và 230 MiB. Node gồm HTTP server, worker threads và bộ điều phối benchmark, tiêu thụ trung bình tương đương 1,13 và 0,94 luồng CPU đầy tải. k6 và Python chạy process riêng.

PATCH riêng tăng từ 101 lên 123 request/giây, latency 69 / 1.541 / 3.386 ms xuống 259 / 273 / 291 ms. FIFO làm trung vị cao hơn khi mọi client liên tục ghi cùng một dataset. Đuôi latency giảm rõ rệt. Write conflict và transaction abort trong đợt này cùng giảm từ 8.144 xuống 0. Hai bản hoàn tất lần lượt 1.598 và 1.870 PATCH trong số tối đa 2.400 ở cửa sổ ngắn.

## Kiểm thử ngưỡng SRS

**PASS** cho tập API đọc đã chọn ở 100 VU liên tục trong 10 phút. k6 ghi nhận 310.242 request, 517 req/s, 0 lỗi đọc và latency tổng p50 / p95 / p99 là 181 / 330 / 361 ms. Tất cả endpoint đều có p95 dưới 500 ms. RAM khả dụng thấp nhất là 6,63 GiB, Node RSS cao nhất lấy mẫu 474 MiB, MongoDB RSS 260 MiB. p95 checkout là 24 ms và p99 event-loop delay là 56 ms.

| API / kịch bản đọc | Request | p50 / p95 / p99 (ms) |
| --- | ---: | ---: |
| Datasets | 44.542 | 141 / 170 / 189 |
| Sensors | 44.113 | 186 / 219 / 243 |
| Readings, 100/trang | 88.447 | 187 / 221 / 245 |
| Readings, cursor sâu | 44.578 | 188 / 221 / 246 |
| Anomalies, theo run | 44.250 | 320 / 366 / 403 |
| Anomaly, chi tiết | 44.312 | 145 / 173 / 192 |

## Chọn thông số cho workload đã đo

Lặp lại kịch bản hỗn hợp trên cùng build với upload 6, scan 3, pool 48 và lần lượt 2 hoặc 3 slot cho cả import và analysis.

| Thông số quan sát | 2 slot | 3 slot |
| --- | ---: | ---: |
| Import hoàn tất / từ chối do hết thời gian chờ | 4 / 2 | 6 / 0 |
| Analysis hoàn tất | 9 | 9 |
| Trung vị chờ claim, giới hạn trên (ms) | 4.210 | 2.836 |
| Trung vị thời gian hoàn tất analysis (ms) | 5.756 | 5.380 |
| Lượt đọc HTTP 200 | 6.855 | 6.748 |
| Python chạy đồng thời / tổng working set đỉnh lấy mẫu (MiB) | 2 / 215 | 3 / 344 |
| RAM khả dụng thấp nhất (GiB) | 6,61 | 6,43 |

Ba slot xử lý hết burst import với thêm khoảng 129 MiB working set Python và giảm 107 lượt đọc hoàn tất trong lần lặp này. Đây là cấu hình dùng cho profile 30 giây, với một native thread cho mỗi Python process. Tổng thời gian CPU Python quan sát ở các thời điểm lấy mẫu lần lượt là 8,2 và 9,1 giây CPU. Số này có thể thấp hơn thời gian CPU thực vì mỗi lần lấy mẫu cách nhau khoảng 0,35 giây cộng độ trễ truy vấn Windows.

Trong phép thử 100 VU ngắn, pool 24 đạt 461 req/s, p95 HTTP 383 ms và p95 checkout 56 ms. Pool 48 đạt 492 req/s, p95 HTTP 342 ms và p95 checkout 26 ms trong lượt đo đối chiếu. Pool 48 cũng đạt ngưỡng trong phép thử 10 phút.

## Kiểm thử backend

| Lệnh | Kết quả cuối |
| --- | --- |
| `npm run check --workspace @pm25/server` | PASS typecheck, lint, build và 72 unit tests |
| `npm run test:integration --workspace @pm25/server -- --maxWorkers=1` | PASS 103 tests trên 13 suite, gồm CSV/JSON, admission, recovery, quyền hiển thị, CAS và Isolation Forest thật |

Regression mới kiểm tra ba upload và hai import đồng thời, key có thể dùng lại khi chờ import quá hạn, keyset theo run giữ thứ tự khi nhiều bản ghi có cùng timestamp và query kiểm tra lại quyền sau preflight.

## Chạy lại

Từ thư mục gốc, dùng Node và k6 CLI. Thiết lập Python/scikit-learn theo `server/ml/README.md` để đo Isolation Forest. Dùng output khác nhau cho từng lần chạy.

```powershell
npm run build --workspace @pm25/server
$env:IMPORT_UPLOAD_CONCURRENCY='6'
$env:IMPORT_CONCURRENCY='3'
$env:IMPORT_MAX_WAITING='4'
$env:IMPORT_WAIT_MS='5000'
$env:IMPORT_SCAN_CONCURRENCY='3'
$env:ANALYSIS_CONCURRENCY='3'
$env:MONGODB_MAX_POOL_SIZE='48'
$env:MONGODB_MAX_CONNECTING='4'
node server/scripts/benchmark-performance.mjs .local/performance-after.json 4,16,40,100,review,mixed
node server/scripts/benchmark-performance.mjs .local/performance-srs.json srs
```

Để đối chiếu baseline, build commit `9e9eb67` ở checkout riêng, chép hai script benchmark vào `server/scripts` và chạy cùng kịch bản với cấu hình mặc định. Giữ cùng bộ Python và artifact. Để dùng index mới trên một database đã chọn, áp dụng bằng lệnh index hiện hành của server trên database đó. Kết quả ở đây dùng replica set tạm. Cấu hình trên là profile đo trên laptop, dùng mặc định bảo thủ trong `.env.example`.

Số liệu gốc nằm trong `.local/performance-baseline.json`, `.local/performance-candidate3.json` và `.local/performance-srs.json`. Số liệu sweep có trong `.local/performance-tuning-2.json`, `.local/performance-tuning-3.json` và `.local/performance-pool24.json`. Báo cáo JSON giữ thống kê k6, explain, checkout, event loop, RAM và kết quả job theo phương pháp.

Phạm vi số liệu là localhost, một account, fixture tổng hợp, một MongoDB node và bộ lọc anomalies theo run. Cần số đo bổ sung để suy rộng ra nhiều dataset, CSV gần giới hạn 100 MiB, truy vấn geo có độ chọn lọc khác, tải ML dài hạn, SSD và failover. Mức tối ưu còn phụ thuộc dữ liệu, tải nền của Windows và tỷ lệ các tác vụ.
