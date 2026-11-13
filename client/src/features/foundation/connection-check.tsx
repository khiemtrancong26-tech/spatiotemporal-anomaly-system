import { useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import { Badge, Button, ErrorState, LoadingState } from '../../shared/ui/primitives';
import { errorMessage } from '../../shared/api/errors';
import type { MockScenario } from '../../mocks/transport';

export function ConnectionCheck() {
  const { data, mock } = useServices();
  const [state, setState] = useState<{ pending: boolean; status?: string; error?: unknown }>({ pending: false });
  const [scenario, setScenario] = useState<MockScenario>(mock?.scenario ?? 'success');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function check() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setState({ pending: true });
    try {
      const health = await data.health({ signal: controller.signal });
      if (!controller.signal.aborted) setState({ pending: false, status: health.status });
    } catch (error) { if (!controller.signal.aborted) setState({ pending: false, error }); }
  }
  return <section className="card connection-card" aria-labelledby="connection-heading">
    <div className="card-heading"><h2 id="connection-heading">Kết nối dữ liệu</h2><Badge tone={mock ? 'warning' : 'blue'}>{mock ? 'Mock transport' : 'API online'}</Badge></div>
    <p className="muted">{mock ? 'Kiểm tra giao diện chờ, thành công và lỗi qua cùng lớp dữ liệu.' : 'Kiểm tra phản hồi Backend trước khi bắt đầu làm việc.'}</p>
    {mock && <label className="field">Tình huống kiểm tra<select value={scenario} onChange={(event) => { const next = event.target.value as MockScenario; request.current?.abort(); mock.scenario = next; setScenario(next); setState({ pending: false }); }}><option value="success">Phản hồi thành công</option><option value="server-error">Server chưa sẵn sàng</option><option value="network-error">Không có kết nối</option><option value="malformed">Response không hợp lệ</option></select></label>}
    {state.pending && <LoadingState label="Đang kiểm tra kết nối…" />}
    {state.error !== undefined && <ErrorState message={errorMessage(state.error)} retry={() => { void check(); }} />}
    {state.status && <p role="status" className={state.status === 'ok' ? 'success-message' : 'warning-message'}>{state.status === 'ok' ? 'Đã nhận phản hồi hợp lệ.' : 'Backend đang ở trạng thái suy giảm.'}{mock && ' Đây là phản hồi mô phỏng.'}</p>}
    <Button variant="secondary" disabled={state.pending} onClick={() => { void check(); }}>Kiểm tra kết nối</Button>
    <small className="muted">Health không thay thế kiểm tra đăng nhập hoặc quyền truy cập.</small>
  </section>;
}
