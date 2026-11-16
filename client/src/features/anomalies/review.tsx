import { useEffect, useRef, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { useStore } from 'zustand';
import { useServices } from '../../app/services';
import type { Anomaly } from '../../shared/api/generated/wire';
import { Button } from '../../shared/ui/primitives';
import { DataSourceError, errorMessage } from '../../shared/api/errors';
import { formatWorkspaceTime, zoneLabel } from '../workspace/time';

export function AnomalyReview({ item, saved }: { item: Anomaly; saved: (a: Anomaly) => void }) {
  const { data, workspace } = useServices(), zone = useStore(workspace, s => s.timeZone);
  const [base, setBase] = useState(item), [status, setStatus] = useState(item.status), [note, setNote] = useState(item.note);
  const [conflict, setConflict] = useState(false), [latest, setLatest] = useState<Anomaly>();
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);
  const dirty = status !== base.status || note !== base.note;
  useEffect(() => { workspace.getState().setReviewDirty(dirty || conflict); return () => workspace.getState().setReviewDirty(false); }, [workspace, dirty, conflict]);
  useBlocker({ shouldBlockFn: () => (dirty || conflict) && !window.confirm('Bỏ bản review chưa lưu?'), enableBeforeUnload: dirty || conflict });
  useEffect(() => () => active.current?.abort(), []);
  async function loadLatest() {
    const controller = new AbortController(); active.current = controller; setPending(true);
    try { const a = await data.anomalies.get(base.id, { signal: controller.signal }); if (!controller.signal.aborted) { if (a.datasetId !== base.datasetId || a.id !== base.id) throw new Error('Dataset không khớp'); setLatest(a); } }
    catch (e) { if (!controller.signal.aborted) setError(errorMessage(e)); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }
  async function save() {
    if (pending || conflict || !dirty) return;
    const controller = new AbortController(); active.current = controller; setPending(true); setError(''); setSuccess(false);
    try {
      const a = await data.anomalies.review(base.id, { baseVersion: base.version, changes: { status, note } }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (a.id !== base.id || a.datasetId !== base.datasetId || a.version <= base.version) throw new Error('Response không khớp');
      setBase(a); setStatus(a.status); setNote(a.note); setSuccess(true); saved(a);
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(errorMessage(e));
        const uncertain = !(e instanceof DataSourceError) || e.kind !== 'http' || (e.status ?? 500) >= 500;
        if (uncertain || (e instanceof DataSourceError && e.status === 409)) { setConflict(true); setLatest(undefined); await loadLatest(); }
      }
    } finally { if (!controller.signal.aborted) setPending(false); }
  }
  return <section className="ux-panel ux-review-form"><div className="ux-panel-heading"><div><h3>Đánh giá của Analyst</h3><p>Chỉ thay đổi trạng thái review và ghi chú.</p></div><span className="badge">v{base.version}</span></div>
    <label className="field">Review status<select aria-label="Review status" disabled={pending} value={status} onChange={e => { setStatus(e.target.value as Anomaly['status']); setSuccess(false); }}><option value="open">Open · Chưa hoàn tất đánh giá</option><option value="confirmed">Confirmed · Phát hiện đáng ghi nhận</option><option value="false_positive">False positive · Không chấp nhận cảnh báo</option></select></label>
    <p>Confirmed ghi nhận đánh giá của con người, không xác nhận nguyên nhân ô nhiễm hoặc chứng minh detector đúng. False positive không khẳng định cảm biến đo sai.</p>
    <label className="field">Ghi chú<textarea aria-label="Ghi chú" disabled={pending} value={note} onChange={e => { setNote(e.target.value); setSuccess(false); }} placeholder="Ghi nhận quan sát, dữ liệu đối chiếu và những điều chưa xác minh." /></label>
    <div className="ux-save-row"><span>Cập nhật {formatWorkspaceTime(base.updatedAt, zone)} · {zoneLabel(zone)}</span><Button aria-label="Lưu review" disabled={pending || conflict || !dirty} onClick={() => { void save(); }}>{pending ? 'Đang lưu…' : 'Lưu đánh giá'}</Button></div>
    {success && <p role="status" className="ux-success">Server đã xác nhận lưu review.</p>}
    {error && <p role="alert" className="ux-warning">{error} Bản sửa vẫn được giữ. Lỗi mạng không chứng minh Server chưa lưu; ứng dụng không tự gửi lại.</p>}
    {conflict && <div className="ux-conflict"><h4>Đối soát đánh giá trên Server</h4><p>Phiên bản có thể đã thay đổi hoặc phản hồi ghi bị mất. Giữ bản sửa và kiểm tra trước khi tiếp tục.</p>{latest ? <><div className="ux-compare"><p>Server v{latest.version}: {latest.status} · {latest.note || '(ghi chú rỗng)'}</p><p>Bản của bạn: {status} · {note || '(ghi chú rỗng)'}</p></div><div className="ux-actions"><Button variant="secondary" disabled={pending} onClick={() => { setBase(latest); setStatus(latest.status); setNote(latest.note); setConflict(false); setError(''); saved(latest); }}>Bỏ bản sửa, dùng Server</Button><Button variant="secondary" disabled={pending} onClick={() => { setBase(latest); setConflict(false); setError(''); }}>Giữ bản sửa trên version mới</Button></div><p>Kiểm tra lại rồi tự bấm Lưu; không tự merge hoặc gửi PATCH.</p></> : <Button variant="secondary" disabled={pending} onClick={() => { void loadLatest(); }}>Đọc lại bản Server</Button>}</div>}
  </section>;
}
