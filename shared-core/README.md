# Shared Core

Package TypeScript dùng chung cho Backend và Web Worker, owner Khải. Không phụ thuộc Fastify, MongoDB, Node runtime hoặc Browser DOM trong source. Có contracts/Zod D008 và adapter thống kê dùng **simple-statistics 8.0.0**; xem [D014](../docs/decisions.md#d014--tích-hợp-thư-viện-trước-b5-15112026) và [báo cáo tích hợp trước B5](../docs/backend/detector-integration-verification.md).

```powershell
npm run build --workspace @pm25/shared-core
npm run typecheck --workspace @pm25/shared-core
npm test --workspace @pm25/shared-core
npm run test:coverage --workspace @pm25/shared-core
```

Exports: `@pm25/shared-core/contracts`, `@pm25/shared-core/statistics` và root export. Build tạo ESM/declarations trong dist; server scripts build shared-core trước typecheck/test/build. Thay đổi contracts/index.ts chỉ sửa module specifier `.js` cho ESM, không đổi fields/validation của Shared Data Contract.

`evaluateStatistics(input, policy)` nhận StatisticalDetectorInput/Output hiện có và **policy bắt buộc**: grouping/reference/order, minSamples, population/sample std, xử lý thiếu dữ liệu, config validation và score/flag mapping. Không có production defaults. Dùng mean/standardDeviation/sampleStandardDeviation/zScore/quantile/interquartileRange của thư viện; Moving Average chỉ ghép cửa sổ trước điểm hiện tại rồi gọi mean/std/zScore. Source không tự viết lại công thức, không có Isolation Forest/Python trong shared package.

Các mode đã có để kiểm chứng: per-sensor scope cho zscore/iqr; preceding count window cho moving_avg; sort ts/id; reject-scope khi một nhóm thiếu dữ liệu; warmup được khai báo omit. Những mode này là năng lực adapter, **không chốt policy dùng thật cho B5**. Phương sai 0 được đưa sang policy như z=null; không chia 0 rồi tạo NaN hoặc anomaly giả. Guard input trùng ID/composite instant, khác dataset, arithmetic/output không hữu hạn; lỗi không trả kết quả partial như completed.

Profile trong `tests/experimental-policies.ts` có nhãn EXPERIMENT-ONLY, không nằm trong package build/export. Chúng minh họa threshold 3/IQR 1.5, minSamples/window/score mapping tường minh; không suy ra severity hoặc production preset. IQR dùng quantile type-7 theo đúng thư viện 8.0.0, cần giữ version khi so sánh kết quả.

Engine thống kê là hàm đồng bộ/CPU; async wrapper không offload nó. Scheduling, workload budget và concurrency thuộc B5/Cường. Worker/offline hiện chưa được nối bởi thay đổi này. Coverage script hiện đo riêng src/statistics, không tuyên bố coverage toàn Shared Contract hoặc chất lượng detector trên nguồn thực.
