# B4 — Query sensors/readings và tích hợp Workspace

Ngày kiểm tra: 14/11/2026. Phạm vi [milestone B4](../backend-online-plan.md#b4--query-sensorsreadings-cho-workspace-và-hai-renderer). Chủ dự án đã chốt ba gate tại [D013](../decisions.md#d013--semantics-query-b4). **Hai API Query đã triển khai; đã chạy luồng import B3 → Query B4 → Workspace bằng file/API/DB thật.** Không sửa OpenAPI, Shared Data Contract hoặc code renderer/adapter FE.

## API và ranh giới

| Operation | Hành vi thật |
|---|---|
| GET `/api/v1/sensors` | datasetId bắt buộc; bbox tùy chọn; sort externalId asc/desc; 200 SensorPage |
| GET `/api/v1/readings` | datasetId bắt buộc; sensorId/bbox/from/to tùy chọn; sort ts asc/desc; 200 ReadingPage |

Cả hai yêu cầu JWT analyst/admin, current-user lookup B2. Mặc định limit 100, tối đa 200; page `{limit,nextCursor}`, cuối trang nextCursor null. GET datasets đã có ở B2/B3 được dùng lại. Có **11/20 operations online/health** thật; 9 operations B5–B7 và 5 operations hoãn còn chưa triển khai. Không thêm region/search, aggregates, dataset detail, API offline hoặc alias URL cũ.

Feature `server/src/modules/query/` giữ Route → Validation → Service → Repository → MongoDB. Route chỉ ghép auth/schema/service. Service gọi **public DatasetReadAccess** từ module Dataset, không import repository nội bộ của feature khác. BSON/query/DTO mapping ở Repository và mapper; response whitelist cả location, không xuất `_id`, sourceRowNumber, importAttemptId hoặc raw persistence documents.

## Quy tắc D013 đã hiện thực

- Dataset không tồn tại → **422 DATASET_NOT_FOUND**; mọi trạng thái chưa imported → **422 DATASET_NOT_READY**. Sensor không tồn tại hoặc thuộc dataset khác → **422 SENSOR_NOT_IN_DATASET**. Không thêm 404 vào Query. ID vẫn opaque: không ép HTTP ID theo regex ObjectId; mã không có trong persistence được coi không tìm thấy, không được dùng externalId làm Reading.sensorId.
- Khoảng thời gian đóng **[from,to]**, có thể thiếu một đầu; from=to hợp lệ. UTC ISO có Z và tối đa 3 chữ số phần lẻ, không truncate/làm tròn. Chuẩn hóa `.000Z` để filter/cursor tương đương. from>to hoặc vi phạm quy tắc ngữ nghĩa → 422; sai cú pháp/schema/cursor → 400. Query không âm thầm đổi offset sang Z; đây là quyết định riêng B4, không tự đóng scope Analysis B5.
- Bbox là rectangle tọa độ WGS84 `[minLon,minLat,maxLon,maxLat]`, nhận cả biên, đường và điểm min=max; đảo chiều/vượt WGS84 → 422. Không wrap qua ±180° khi west>east. Scalar lon/lat quyết định membership; không dùng cạnh cung lớn của polygon để thay biên rectangle.
- Reading trả location snapshot đã lưu, UTC ts, PM2.5 value/unit; không join Sensor hiện tại để ghi đè tọa độ lịch sử. Zero/high finite hợp lệ theo B3. Sensor thuộc cùng dataset được kiểm tra trước khi query readings.
- Auth 401 có WWW-Authenticate, method khác 405/Allow, lỗi DB được giữ là 500 an toàn thay vì trang rỗng 200. Dataset hợp lệ nhưng không có kết quả trả 200/data rỗng. Query parameter ngoài schema và pagination wire không hợp lệ bị từ chối, không strip/coerce âm thầm thành truy vấn khác.

## Pagination, cursor và bộ nhớ

Repository query projection, sort `(externalId,_id)` hoặc `(ts,_id)` đúng chiều và **limit+1**, không skip/toArray toàn dataset rồi mới cắt trang. Read preference primary. Limit hiển thị FE 2.000 readings/phiên không phải giới hạn dữ liệu Server hoặc Analysis; test đã đi qua 2.113 readings bằng nhiều trang, mỗi trang tối đa 200.

Cursor HMAC của B1 gắn operation/dataset/sensor/bbox/time/sort; đổi bộ lọc/sort phải bắt đầu lại. Giá trị tương đương sau chuẩn hóa (106/106.0, Z/.000Z, ID canonical) dùng tiếp được; có thể đổi page limit. Readings giữ ts/ID làm mốc tự chứa. Sensors dùng digest SHA-256 của externalId + anchor ID trong cursor đã ký, rồi đọc đúng một anchor trong dataset để khôi phục khóa đầy đủ: mã trạm dài không làm URL/cursor quá lớn và không thêm maxLength ngoài contract. Anchor bị đổi/xóa → 400, bắt đầu lại; đã test mã trạm Unicode dài hơn 4 KiB với cursor dưới 512 ký tự.

Không hứa snapshot giữa các request. Reading thêm trước mốc có thể không xuất hiện ở trang sau; thêm sau mốc có thể xuất hiện. Tie-break và cursor không có nghĩa giữ một snapshot cũ. Số rows vào Node được chặn theo page, **không suy ra response bytes hoặc RSS có một trần tuyệt đối** khi chuỗi hợp lệ trong DTO rất dài.

## Index, bbox và số đo trước/sau

Giữ **13 indexes online trên 7 collections**, không thêm index hoặc hint production. Baseline dùng scalar rectangle chính xác nhưng bbox rỗng trên 500k phải scan 500k. Tối ưu sau số đo thêm circle bao ngoài làm prefilter cho 2dsphere hiện có; scalar vẫn là điều kiện cuối nên không đổi kết quả.

Chứng minh bao ngoài: đường đi theo meridian rồi parallel có độ dài góc không lớn hơn `|Δlat|+|Δlon|`; khoảng cách cung ngắn nhất không lớn hơn đường đi này. Bán kính dùng nửa span lat + nửa span lon, đổi sang radian và thêm 1e-6 rad (~6 m) để bảo vệ biên số học. Circle ≥π được bỏ để tránh hạn chế world/bbox rộng. Đã so sánh membership bằng haversine độc lập và MongoDB thật tại cực, ±180°, corners, world/line/point, điểm ngoài cạnh bắc. `$centerSphere` hỗ trợ GeoJSON và 2dsphere theo [MongoDB manual](https://www.mongodb.com/docs/manual/reference/operator/query/centerSphere/); [polygon/degenerate caveats](https://www.mongodb.com/docs/manual/reference/operator/query/geoWithin/) là lý do không thay rectangle bằng polygon.

Artifacts đầy đủ:

- [Baseline trước tối ưu](b4-query-baseline.json): measurement snapshot thu trước khi thêm circle; cùng seed/13 indexes, gồm thử nghiệm 2d riêng trên DB tạm.
- [Sau tối ưu](b4-query-measurements.json): script hiện tại dùng đúng `buildQuery()` của production cho explain; HTTP thật qua route/auth/service/repository cho latency/response.
- [Script tái lập số đo hiện tại](../../server/scripts/benchmark-query.ts): tạo replica set/database mô phỏng tạm, seed bounded batch, không dùng DB/credentials người dùng. Không phải import 500k qua B3 hoặc đánh giá detector. Dataset seed có nhãn `[SYNTHETIC B4]` và không được xem là nguồn thực.

Môi trường: Windows, Ryzen 5 5500U/12 logical CPUs, RAM khoảng 15,34 GiB, Node 24.14.1, MongoDB **9.0.4/WiredTiger**, replica set 1 node tạm. Mỗi dataset 100k/200 trạm hoặc 500k/500 trạm; nhịp 1 phút trong seed chỉ phục vụ phép đo, không chốt đặc tính nguồn. 1 warmup + **10 request tuần tự/case**, một client HTTP localhost, không TLS, máy phát triển dùng chung. Diagnostic DB timeout 10 giây để đo truy vấn chậm; mặc định runtime vẫn 2 giây. p95 dưới đây là mẫu nhỏ cục bộ, không phải nghiệm thu mục tiêu SRS 100 VU/10 phút.

| Readings | Case | p95 trước → sau (ms) | Docs examined trước → sau |
|---|---|---|---|
| 100,000 | sensors_bbox | 9.77 → 9.60 | 200 → 21 |
| 100,000 | readings_default | 9.55 → 9.60 | 101 → 101 |
| 100,000 | readings_time | 10.25 → 9.61 | 101 → 101 |
| 100,000 | readings_sensor_time_bbox | 10.38 → 11.23 | 11 → 11 |
| 100,000 | readings_bbox | 26.59 → 33.92 | 2,254 → 2,254 |
| 100,000 | readings_bbox_empty | 232.53 → 6.87 | 100,000 → 0 |
| 100,000 | readings_deep_cursor | 13.73 → 14.55 | 101 → 101 |
| 500,000 | sensors_bbox | 9.11 → 7.51 | 500 → 21 |
| 500,000 | readings_default | 9.13 → 7.97 | 101 → 101 |
| 500,000 | readings_time | 9.99 → 8.04 | 101 → 101 |
| 500,000 | readings_sensor_time_bbox | 9.43 → 7.98 | 11 → 11 |
| 500,000 | readings_bbox | 48.35 → 101.77 | 5,554 → 5,554 |
| 500,000 | readings_bbox_empty | 2285.34 → 7.38 | 500,000 → 0 |
| 500,000 | readings_deep_cursor | 15.72 → 8.37 | 101 → 101 |

Trong các case trên, sampled heap growth tối đa 12.89 MiB và sampled RSS growth tối đa 9.01 MiB; đây là process kết hợp Backend/harness với giới hạn phép đo ở dưới.

Các truy vấn default/time/deep cursor dùng ix_readings_dataset_ts_id; filter sensor/time dùng uq_readings_dataset_sensor_ts; bbox rỗng sau tối ưu dùng ix_readings_dataset_geo. Sensors bbox dùng ix_sensors_dataset_geo. Một số case có SORT (sensors tie-break, sensor/time), không che giấu blocking sort. Không cam kết mọi workload bbox đều nhanh hơn: xem số đo và tradeoff trong bảng, phải profile lại trên nguồn/triển khai thật.

2d coordinate index chỉ được tạo rồi xóa trong DB tạm của baseline để so sánh: empty bbox xem 0 docs, nhưng bbox có dữ liệu ở 500k xem 9.000 docs và SORT (56 ms executionStats). Không dùng thử nghiệm này làm bằng chứng đã chọn/thêm index. Tối ưu cuối dùng index 2dsphere đã có.

Response 100 readings trong các case đã đo khoảng 22,5–22,6 KB. Memory sampler 5 ms đo tăng RSS/heap trong **cùng Node process chứa Backend + fetch harness**, sau warmup/GC; không gồm mongod, không phải peak riêng của Server, không bao gồm mọi đỉnh giữa hai lần sample. Xem JSON cho số byte chính xác; chưa đánh đồng với proof RAM/FPS/GC/load toàn hệ thống.

## Fixture bàn giao Tài

File [b4-boundaries.csv](../../server/tests/fixtures/b4-boundaries.csv) là dữ liệu mô phỏng nhỏ để upload qua wizard B3. Mapping năm cột cùng tên, unit ug/m3; nếu dùng REST có thể map thêm name/region/unit. Wizard hiện chỉ map năm cột nên tên trạm mặc định là externalId; không thêm UI/field ngoài contract để có tên khác.

| Truy vấn | Kết quả mong đợi từ fixture |
|---|---|
| Không filter | 5 sensors, 8 readings |
| bbox 106,10,107,11 | 4 sensors, 7 readings; loại OUT-N |
| Bbox trên + from 2026-11-14T00:00:00Z/to 01:00:00Z | 5 readings; nhận cả hai mốc, zero hợp lệ |
| from=to=2026-11-14T00:00:00Z | 2 readings |
| bbox 106.5,10.5,106.5,10.5 | 1 sensor C, 4 readings |
| bbox 106,11,107,11 | 2 sensors/2 readings |
| bbox 0,0,1,1 | 200/data rỗng |
| sensorId nội bộ của C + khoảng 00:00–01:00Z | 2 readings; không gửi literal C thay cho sensorId |

UI UTC+07 tương ứng 07:00–08:00 ngày 14/11. B4 browser E2E đã xác nhận filter gửi đúng Z, selection giữ khi đổi Cube/Mapbox, chọn Sensor ID, sort, empty và reload. Query dữ liệu không dùng HTTP intercept. Không có token nghiệm thu Mapbox nên chỉ kiểm tra nhánh thiếu token và bảng/selection; **chưa xác minh tiles/camera/click Mapbox thật hoặc FPS/GPU**. Anomaly overlay nối sau B6.

## Kiểm chứng và tái lập

```powershell
# Tùy máy: nếu dùng system binary, kiểm tra --version trước.
$env:MONGOMS_SYSTEM_BINARY='C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe'
# Default download pin của harness là 8.2.6; lượt này thực chạy system binary 9.0.4.
$env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK='false'
npm run check
npm run test:coverage --workspace @pm25/server
npm run test:e2e:b4
# Hồi quy E2E thật B2/B3 cũng có scripts test:e2e:b2 và test:e2e:b3.
npm run benchmark:query --workspace @pm25/server
```

Không có system binary thì mongodb-memory-server tải bản mặc định; lỗi tải/khởi động là lỗi test, không chuyển sang mock/skip. Lượt này chỉ tuyên bố đã chạy **9.0.4**, chưa chốt phiên bản triển khai của Cường. Temp cleanup kiểm tra root, không xóa DB/storage bên ngoài fixture. Benchmark ghi đè báo cáo sau tối ưu; baseline là snapshot lịch sử trước thay đổi, không bị ghi đè bởi lệnh đó.

| Kiểm tra | Kết quả |
|---|---|
| Root check | Client/server typecheck, lint, unit/HTTP/contract và build; generator giữ 20 operations/33 schemas, OpenAPI/shared wire không đổi |
| Unit B4 | DTO whitelist, WGS84/UTC, parent/sensor guards, filter-bound cursors, limit+1 và proof circle bao ngoài; repository dùng test doubles có nhãn trong unit |
| MongoDB B4 integration | B3 import CSV thật; range/bbox biên, mọi parent chưa imported, isolation/sensor mismatch, cùng ts/sort hai chiều, cursor sai/đổi filter, long ID/anchor mutation, location snapshot, 2.113 rows qua paging, DB failure 500 |
| Gate B3 → B4 | Fault sau actual batch commit: partial đã nằm DB nhưng list/sensors/readings chặn; failed sau cleanup vẫn chặn; remap/new key retry imported rồi Query đọc thành công |
| Browser thật | B2 1 case, B3 2 cases, B4 1 case; API/DB thật, không route intercept/mock transport |
| Performance | 100k/500k seed + explain/projection/response/process memory và baseline/after; chưa chạy stress 100 VU/10 phút, failover hoặc TLS |

Kết quả cuối: **root check PASS** (client 76 tests, server 52 unit/HTTP/contract tests); **coverage suite PASS 90 tests/11 files**, gồm 38 integration tests DB thật (B4: 11). Coverage Server: statements **92,38%**, branches **89,39%**, functions **93,40%**, lines **97,00%**; Query module lines **98,88%**. Coverage tính src/** trừ main.ts, không tính benchmark/scripts/E2E vào production coverage.

Suite browser thật B2–B4 đạt **4/4 cases**; B4 được chạy lại đạt sau tối ưu địa lý. Client 18 E2E mock/intercept của lượt B3 là bằng chứng hồi quy lịch sử riêng, không được cộng vào số E2E Backend thật hoặc tuyên bố rerun trong B4.

Source chính: [unit](../../server/tests/query.test.ts), [DB integration](../../server/tests/b4.integration.test.ts), [browser B4](../../server/e2e/b4.spec.ts), [contract drift](../../server/tests/contract.test.ts). Regression B3 test được cập nhật: sensors/readings hiện có handler và thiếu datasetId trả 400; các API hoãn vẫn 404. Test hook async của Fastify được kiểm chứng qua HTTP thật; E2E locator label được chỉnh theo accessible text thực tế, không thay response để pass.

## Phân công và giới hạn bàn giao

- **Khiêm:** implementation/local verification B4, D013, public read boundary, fixture, script/số đo và tài liệu đã có. Gate import → Query đã kiểm tra; không suy ra mọi Query/Analysis tương lai tự có guard.
- **Tài:** nhận API/fixture để review hai renderer/thiết bị; cần token Mapbox hợp lệ và kiểm tra dịch vụ bản đồ thật. Không suy ra Tài đã nghiệm thu thủ công từ kết quả tự động.
- **Khải:** B4 cung cấp dữ liệu đúng contract; statistical/ML/model/config/severity và cách lấy scope đầy đủ thuộc B5, không dùng 2.000 điểm FE làm toàn bộ Analysis.
- **Cường:** triển khai DB/volume/proxy/TLS/CI, chạy lại số đo với timeout/topology thật, kiểm tra load/heap/GC và mục tiêu SRS. Không xem 10 samples một client là pass 100 VU hoặc quyết định tăng concurrency.
- **Còn lại:** B5–B7, overlay B6, load/stress/3D FPS và hạ tầng triển khai. Offline/Sync/P1/P2 vẫn hoãn; không có endpoint hoặc quyết định queue/model mới trong B4.
