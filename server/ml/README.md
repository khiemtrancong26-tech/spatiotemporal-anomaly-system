# Isolation Forest — B5 và phép thử D014

## Baseline PM2.5 của B5 (D015)

B5 dùng `pm25-iforest-uci381-v1`, một feature `value` ug/m3, scikit-learn1.9.1; không dùng model x0/x1 bên dưới. Model được tạo bằng CLI **offline** trên dữ liệu PM2.5 UCI381 do chủ dự án cho phép tự chọn. [Manifest](pm25-manifest.json) ghi provenance/hash/parameters/reference/runtime; [B5 runbook](../../docs/backend/b5-verification.md) ghi API, worker và giới hạn chất lượng.

Setup từ root repo, Python3.11 (đã kiểm chứng3.11.9), môi trường riêng:

```powershell
py -3.11 -m venv .local/detector-venv
.local/detector-venv/Scripts/python.exe -m pip install -r server/ml/requirements-pm25.txt
.local/detector-venv/Scripts/python.exe server/ml/train_pm25_baseline.py --output-dir .local/models/pm25-iforest-v1 --manifest server/ml/pm25-manifest.json
```

CLI pin hash ZIP/CSV, kiểm tra runtime, không ghi đè artifact/manifest khác; lần đầu cần network để lấy dữ liệu, sau đó dùng cache đã kiểm tra hash. Artifact được giữ tại `.local/models/pm25-iforest-v1/isolation_forest.joblib` (gitignored), đã tạo trong workspace này. Khi triển khai, copy **artifact đã tin cậy, đúng hash** ra persistent volume và set `ANALYSIS_ARTIFACT`; venv qua `ANALYSIS_PYTHON` absolute path. Package `server/ml` cùng build `server/dist`, vì inference script và manifest là runtime assets; không chỉ copy dist. Linux venv dùng `bin/python`, đặt env tương ứng.

Backend không gọi CLI training/download. Thiếu/hỏng model/runtime: trước tiếp nhận ML→503, sau tiếp nhận→run failed; không fallback hoặc train lại. Inference kiểm tra hash manifest khớp hash/model ID pin của build rồi kiểm tra verified artifact bytes trước joblib.load. Không nhận model/path/feature config từ HTTP.

Inference cố định `method=isolation_forest`, `config={}`, flag theo predict=-1, score=-decision_function, severity low tạm. Một feature không mô hình hóa quan hệ không gian/thời gian; không có anomaly labels để suy ra accuracy/precision/recall. Khải còn đánh giá domain/chuyển miền. Các tham số train do CLI ghi rõ, không phải config có thể sửa qua API.

## Demo D014 trước B5 — giữ riêng cho regression tests

Owner thuật toán/model: Khải; Backend adapter: Khiêm; môi trường/CI: Cường. [D014](../../docs/decisions.md#d014--tích-hợp-thư-viện-trước-b5-15112026) chỉ chốt tích hợp thư viện và phép thử, chưa chốt model/feature/runtime production hoặc triển khai B5.

Artifact đã chọn: [sklearn-docs/anomaly-detection](https://huggingface.co/sklearn-docs/anomaly-detection/tree/8689ffabbcd62a83317502891610d4dee4f6201e), pipeline StandardScaler + IsolationForest, hai features tổng hợp x0/x1. Model card có nhãn demo/not production; không phải model được train/đánh giá cho PM2.5. Feature order, revision, hash, bytes và runtime trong [manifest](artifact-manifest.json). Artifact binary lưu local/gitignored; không download khi Backend khởi động hoặc infer.

Setup Windows/Python **3.11**, từ root repo:

```powershell
python -m venv .local/iforest-artifact-venv
.local/iforest-artifact-venv/Scripts/python.exe -m pip install -r server/ml/requirements-artifact.txt
.local/iforest-artifact-venv/Scripts/python.exe server/ml/fetch_artifact.py
npm run verify:detectors
```

Linux dùng `bin/python` của venv và đặt `DETECTOR_PYTHON` thành absolute path khi chạy CLI/tests. `DETECTOR_ARTIFACT` có thể chỉ định bản local khác **cùng hash**. Đây là biến override của harness, chưa phải cấu hình API B5. Môi trường tương thích khóa sklearn 1.2.2 theo metadata upstream; các dependency khác được pin ở requirements và kiểm tra trước load. Không thay phiên bản Python/package global. Build statistical shared-core được npm pre-hook chạy trước CLI/server checks.

`fetch_artifact.py` chỉ tải file từ revision đã pin và kiểm tra SHA-256/size; không tải/chạy source Python từ model repo. `isolation_forest.py` chỉ load/predict, không fit/train. Pickle có thể chạy code khi load: loader này chỉ dành cho artifact nguồn đã chọn/review, hash giữ integrity chứ không chứng minh mọi pickle an toàn. Không nhận artifact/manifest/path từ HTTP. Runtime kiểm tra hash trước khi load từ chính verified bytes trong RAM để tránh thay file giữa hash và load; không load arbitrary pickle uploads.

Protocol private JSON/stdin/stdout version 1, không HTTP service. Input: features đúng thứ tự manifest và rows gồm readingId/values đủ số cột; không pad/đoán features. Output giữ prediction (+1/-1), decision_function, score_samples gắn đúng readingId; thấp hơn trong native scores thường bất thường hơn, không phải probability/severity. Score projection sang candidate do caller cung cấp tường minh. Model/runtime/hash/features sai hoặc model mất trả lỗi, không tự train/fallback dữ liệu giả.

Node runner dùng absolute executable/script paths, argv với shell=false/windowsHide, deadline/byte/concurrency budgets bắt buộc, chờ process close trước trả slot. Drains stderr nhưng không đưa traceback/path/payload ra response/log. Env child chỉ lấy các biến OS cần thiết và giới hạn native threads cho phép thử; không chuyển JWT/Mongo credentials. Đây không phải OS security sandbox hoặc topology worker/concurrency production đã được duyệt.

Limits trong harness: 1 runner slot, input/output 1 MiB, timeout 30 giây. Chúng chỉ phục vụ integration fixture, không phải hạn mức Analysis scope 30k/500k readings. B5 phải thiết kế/chốt batching, scheduling, admission và ngân sách theo số đo; không dùng trang FE làm toàn scope.

Xem [báo cáo kiểm chứng](../../docs/backend/detector-integration-verification.md) cho fixture, raw scores, tests và phần còn mở. Không chạy pipeline khác domain hoặc thiếu 23/67 features rồi điền 0 để coi là PM2.5 detector; production feature extraction/model evaluation vẫn cần Khải xác nhận trước B5.
