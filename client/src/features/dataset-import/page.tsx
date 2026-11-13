import { useEffect, useRef, useState } from 'react';
import { Link, useBlocker } from '@tanstack/react-router';
import { useServices } from '../../app/services';
import { Button, Field, LoadingState, PageTitle } from '../../shared/ui/primitives';
import { DataSourceError, errorMessage } from '../../shared/api/errors';
import type { Dataset, MappingRequest, ValidationReport } from '../../shared/api/generated/wire';
const fields = ['sensorId', 'latitude', 'longitude', 'timestamp', 'value'] as const;
type Draft = Record<typeof fields[number], string>;
interface Context { id?: string; uploadKey?: string; importKey?: string }
export function ImportPage() {
  const { data, config, datasets, session } = useServices();
  const storageKey = `pm25.import.${config.mode}`;
  const [context, setContext] = useState<Context>(() => {
    try { const value = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}'); return { id: typeof value.id === 'string' ? value.id : undefined, uploadKey: typeof value.uploadKey === 'string' ? value.uploadKey : undefined, importKey: typeof value.importKey === 'string' ? value.importKey : undefined }; } catch { return {}; }
  });
  const [file, setFile] = useState<File>();
  const [name, setName] = useState('');
  const [report, setReport] = useState<ValidationReport>();
  const [dataset, setDataset] = useState<Dataset>();
  const [mapping, setMapping] = useState<Draft>({ sensorId: '', latitude: '', longitude: '', timestamp: '', value: '' });
  const [confirmed, setConfirmed] = useState(false);
  const [sourceConfirmed, setSourceConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const upload = useRef<{ file: File; name: string; key: string } | null>(null);
  const finished = dataset?.status === 'imported';
  const completed = finished || report?.status === 'imported';
  const dirty = !completed && Boolean(file || context.id || context.uploadKey);
  useBlocker({ shouldBlockFn: () => dirty && session.store.getState().status === 'authenticated' && !window.confirm('Rời wizard? Ngữ cảnh tối thiểu được giữ trong tab; request đang gửi có thể vẫn được Server xử lý.'), enableBeforeUnload: dirty });
  function save(next: Context) { sessionStorage.setItem(storageKey, JSON.stringify(next)); setContext(next); }
  function message(cause: unknown) {
    if (cause instanceof DataSourceError) {
      if (cause.status === 413) return 'File vượt giới hạn Backend cho phép.';
      if (cause.status === 415) return 'Backend không hỗ trợ định dạng file này.';
      if (cause.status === 422) return 'Dữ liệu hoặc mapping không hợp lệ. Kiểm tra cột nguồn, múi giờ và đơn vị.';
      if (cause.kind === 'network' || cause.kind === 'aborted' || cause.kind === 'invalid-response') return 'Chưa xác định kết quả thao tác. Kiểm tra trạng thái; không tạo thao tác mới để thay thế request vừa gửi.';
    }
    return cause instanceof DataSourceError ? errorMessage(cause) : cause instanceof Error ? cause.message : 'Không thể hoàn tất thao tác.';
  }
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setPending(true); setError('');
    try { await action(controller.signal); } catch (cause) { if (!controller.signal.aborted) setError(message(cause)); }
    finally { if (!controller.signal.aborted) { active.current = null; setPending(false); } }
  }
  async function validation(id: string, signal: AbortSignal) {
    const result = await data.datasets.validation(id, { signal });
    if (signal.aborted) return;
    setReport(result); setDataset(undefined); setConfirmed(false); setSourceConfirmed(false);
    if (result.status === 'imported') sessionStorage.removeItem(storageKey);
    setMapping(Object.fromEntries(fields.map((field) => [field, result.sourceColumns.includes(result.mappingSuggestions[field]) ? result.mappingSuggestions[field] : ''])) as Draft);
  }
  useEffect(() => {
    const controller = new AbortController();
    if (context.id) void validation(context.id, controller.signal).catch((cause) => { if (!controller.signal.aborted) setError(message(cause)); });
    return () => { controller.abort(); active.current?.abort(); active.current = null; };
    // Restore once per mount; state transitions explicitly load their own report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const status = dataset?.status ?? report?.status;
  const canMap = report && ['uploaded', 'awaiting_mapping'].includes(status ?? '') && !context.importKey;
  return <><PageTitle eyebrow="IMPORT DATASET" title="Nhập dataset" description="Upload → Validation → Mapping → Import và kết quả" /><section className="card import-wizard">
    <h2>1. Upload CSV / JSON</h2><p className="metadata-notice">Chỉ hỗ trợ dữ liệu PM2.5 có đơn vị ug/m3 và timestamp kèm Z hoặc offset rõ ràng. Chuẩn hóa dữ liệu khác trước khi nhập; không tự gán múi giờ.</p>
    <Field label="File nguồn" type="file" accept=".csv,.json" disabled={pending || Boolean(context.uploadKey || context.id)} onChange={(event) => setFile(event.target.files?.[0])} />
    <Field label="Tên dataset (tùy chọn)" value={name} disabled={pending || Boolean(context.uploadKey || context.id)} onChange={(event) => setName(event.target.value)} />
    <Button disabled={pending || Boolean(context.id) || (!file && !upload.current) || Boolean(context.uploadKey && !upload.current)} onClick={() => { void run(async (signal) => {
      if (!upload.current) {
        if (!file || !/\.(csv|json)$/i.test(file.name)) throw new Error('Chọn file CSV hoặc JSON.');
        upload.current = { file, name, key: crypto.randomUUID() };
      }
      const intent = upload.current;
      save({ uploadKey: intent.key });
      let result: Dataset;
      try { result = await data.datasets.upload({ file: intent.file, name: intent.name || undefined }, { signal, idempotencyKey: intent.key }); }
      catch (cause) {
        if (cause instanceof DataSourceError && [413, 415, 422].includes(cause.status ?? 0)) { save({}); upload.current = null; }
        throw cause;
      }
      if (signal.aborted) return;
      save({ id: result.id, uploadKey: intent.key }); setDataset(result);
      await validation(result.id, signal);
    }); }}>{context.id ? 'Đã upload' : context.uploadKey ? 'Thử lại upload cùng thao tác' : 'Upload'}</Button>
    {context.uploadKey && !context.id && !upload.current && <p role="alert">Upload trước chưa có ID xác nhận. Không tự upload lại sau reload; kiểm tra với Backend trước khi tạo dataset mới.</p>}
    {context.id && <><h2>2. Validation</h2><p>Dataset ID: {context.id} · Trạng thái: {status ?? 'Chưa đọc được'}</p><Button variant="secondary" disabled={pending} onClick={() => { void run((signal) => validation(context.id!, signal)); }}>Đọc lại trạng thái / validation</Button></>}
    {report && <><p>Tổng {report.totalRows} dòng · Hợp lệ {report.validRows} · Không hợp lệ {report.invalidRows}</p><p>Cột nguồn: {report.sourceColumns.join(', ')}</p><div className="table-scroll"><table><thead><tr><th>Dòng</th><th>Trường</th><th>Lý do</th><th>Dòng được giữ</th></tr></thead><tbody>{report.issues.map((issue, index) => <tr key={index}><td>{issue.rowNumber}</td><td>{issue.field ?? '—'}</td><td>{issue.reason}</td><td>{issue.keptRowNumber ?? '—'}</td></tr>)}</tbody></table></div><small>Hiển thị {report.issues.length} lỗi do Server trả về; không suy ra đây là toàn bộ lỗi nguồn.</small><h2>3. Xác nhận mapping</h2>{fields.map((field) => <label className="field" key={field}>{field}<select value={mapping[field]} disabled={pending || !canMap} onChange={(event) => { setMapping({ ...mapping, [field]: event.target.value }); setConfirmed(false); }}><option value="">Chọn cột nguồn</option>{report.sourceColumns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>)}<p>Đơn vị đích: µg/m³ (ug/m3)</p><label><input type="checkbox" checked={sourceConfirmed} disabled={pending || !canMap} onChange={(e) => { setSourceConfirmed(e.target.checked); setConfirmed(false); }} /> Tôi đã kiểm tra nguồn dùng ug/m3 và timestamp có Z/offset. Backend vẫn phải kiểm tra dữ liệu.</label><Button disabled={pending || !canMap || !sourceConfirmed} onClick={() => { void run(async (signal) => {
      if (fields.some((field) => !report.sourceColumns.includes(mapping[field]))) throw new Error('Chọn đủ năm cột nguồn bắt buộc.');
      const body: MappingRequest = { fieldMap: { ...mapping }, unit: 'ug/m3' };
      const result = await data.datasets.setMapping(context.id!, body, { signal });
      if (!signal.aborted) { setDataset(result); setConfirmed(true); }
    }); }}>Lưu mapping</Button></>}
    {context.id && <><h2>4. Import và kết quả</h2>{context.importKey && !completed && <p>Đã có thao tác import: giữ nguyên mapping và key khi thử lại. Đọc lại trạng thái trước khi quyết định; không tạo import mới.</p>}<Button disabled={pending || finished || (!confirmed && !context.importKey) || status === 'failed' || status === 'imported' || !report} onClick={() => { void run(async (signal) => {
      const next = { ...context, importKey: context.importKey ?? crypto.randomUUID() }; save(next);
      const result = await data.datasets.import(next.id!, { signal, idempotencyKey: next.importKey });
      if (signal.aborted) return;
      setDataset(result);
      if (result.status === 'imported') { datasets.set(result.id, result); sessionStorage.removeItem(storageKey); }
    }); }}>{completed ? 'Đã import' : context.importKey ? 'Thử lại import cùng key' : 'Import'}</Button></>}
    {report?.status === 'imported' && !finished && <p>Server báo dataset đã imported. Có thể chọn dataset từ danh sách; không gửi lại import để lấy metadata.</p>}
    {dataset?.importSummary && <div><p>Đã nhập: {dataset.importSummary.importedRows} · Trùng hoàn toàn: {dataset.importSummary.duplicateRows} · Xung đột: {dataset.importSummary.conflictingRows} · Không hợp lệ: {dataset.importSummary.invalidRows}</p>{dataset.importSummary.issues.map((issue, index) => <p key={index}>Dòng {issue.rowNumber}: {issue.reason}; giữ dòng {issue.keptRowNumber ?? '—'}</p>)}</div>}
    {status === 'failed' && <p role="alert">Import thất bại. Cần Backend xác nhận cleanup trước khi tạo thao tác retry mới.</p>}
    {finished && <Link className="button button--primary" to="/workspace/$datasetId" params={{ datasetId: dataset!.id }}>Mở workspace</Link>}
    {(finished || report?.status === 'imported') && <Link className="text-link" to="/datasets">Về Datasets</Link>}
    {pending && <LoadingState label="Đang chờ Backend xác nhận…" />}{error && <p role="alert" className="text-error">{error}</p>}
  </section></>;
}
