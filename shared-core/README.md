# Shared Core

Package dùng chung cho Client (Web Worker) và Server: `@sta/shared-core`.

- Người phụ trách: Khải. Tích hợp ML vào Server: Khải + Khiêm.
- TypeScript thuần + Zod. **Không** phụ thuộc Fastify, MongoDB, DOM hay API chỉ có ở Node (trong `src/`).
- `scripts/` là công cụ dev (dùng Node `fs`), không nằm trong bundle.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `src/contracts/` | Zod/TS của Shared Data Contract (`docs/shared-data-contract.md`) |
| `src/detectors/` | Z-score, IQR, Moving Average (`runStatisticalDetector`) |
| `src/ml/` | Isolation Forest, feature, model artifact, `createMlAdapter` |
| `src/severity.ts` | Đề xuất ánh xạ score → severity (OPEN-04) |
| `src/testing/` | Dữ liệu giả lập có nhãn, `evaluate()` |
| `models/` | Model artifact đã huấn luyện (hiện huấn luyện trên **dữ liệu giả lập**) |
| `fixtures/` | CSV mẫu dạng upload nguồn (timestamp kèm `+07:00`) + nhãn |
| `tests/` | Vitest |

## Dùng cho Server (Khiêm)

```ts
import {
  runStatisticalDetector, buildAnomalyDrafts, createMlAdapter, ENGINE_VERSION,
} from '@sta/shared-core';

// Thống kê: 1 kết quả cho mỗi reading, theo thứ tự đầu vào
const out = runStatisticalDetector({ method: 'zscore', readings, config: { threshold: 3 } });
if (out.status === 'completed') {
  const drafts = buildAnomalyDrafts(readings, 'statistical', out.method, out.results);
  // Backend bổ sung id, analysisRunId, updatedAt rồi lưu
}

// ML (chỉ Server): nạp model một lần lúc khởi động
const ml = createMlAdapter(JSON.parse(readFileSync('shared-core/models/pm25-iforest-v1.json', 'utf8')));
const mlOut = await ml.detect(readings);        // mlOut.modelVersion -> AnalysisRun.modelVersion
const mlDrafts = buildAnomalyDrafts(readings, 'ml', mlOut.method, mlOut.results);
```

Chi tiết hành vi, trạng thái và đề xuất bổ sung hợp đồng: `docs/detectors.md`, `docs/ml-design.md`.

## Lệnh

```bash
npm test -w shared-core                 # unit test
npm run test:coverage -w shared-core    # coverage, ngưỡng 90% (mục tiêu SRS)
npm run typecheck -w shared-core
npm run build -w shared-core
npm run train -w shared-core            # huấn luyện lại (thêm -- --csv file.csv cho dữ liệu thật)
npm run benchmark -w shared-core        # so sánh 4 phương pháp trên dữ liệu giả lập
npm run fixture -w shared-core          # sinh lại CSV mẫu
```

## Quy tắc phối hợp

Đổi schema/contract hoặc chữ ký detector phải báo Khiêm, Tài, Duy trước khi merge (`docs/ownership.md`).
