import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { useServices } from '../../app/services';
import { Button, Field, PageTitle, LoadingState, ErrorState } from '../../shared/ui/primitives';
import { createCursorPager } from '../../shared/lib/cursor-pager';
import { DataSourceError, errorMessage } from '../../shared/api/errors';
import type { AdminUserCreateRequest, UserPublic } from '../../shared/api/generated/wire';
function explain(cause: unknown) {
  if (cause instanceof DataSourceError && cause.status === 409 && cause.error?.code === 'USERNAME_CONFLICT') return 'Username đã tồn tại. Chọn username khác.';
  if (cause instanceof DataSourceError && cause.status === 409) return 'Username trùng hoặc thao tác đang được xử lý. Kiểm tra danh sách/Backend trước khi tạo thao tác mới.';
  return errorMessage(cause);
}
function CreateUser({ changed, dirtyRef }: { changed: () => void; dirtyRef: { current: boolean } }) {
  const { data, config } = useServices();
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [role, setRole] = useState<'analyst' | 'admin'>('analyst');
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const active = useRef<AbortController | undefined>(undefined);
  const intent = useRef<{ body: AdminUserCreateRequest; key: string; expires: number } | undefined>(undefined);
  const dirty = pending || unknown || Boolean(username || password);
  useEffect(() => { dirtyRef.current = dirty; return () => { dirtyRef.current = false; }; }, [dirty, dirtyRef]);
  useEffect(() => {
    if (!unknown || !intent.current) return;
    const timer = window.setTimeout(() => { intent.current = undefined; setExpired(true); setError('Hết thời gian giữ ngữ cảnh retry. Kiểm tra kết quả với Backend.'); }, Math.max(0, intent.current.expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [unknown]);
  useBlocker({ shouldBlockFn: () => dirty && !window.confirm('Rời trang? Request đã gửi có thể vẫn được xử lý; ngữ cảnh retry chỉ giữ trong RAM và sẽ bị xóa.'), enableBeforeUnload: dirty });
  useEffect(() => () => { active.current?.abort(); intent.current = undefined; }, []);
  async function submit() {
    if (expired || active.current || (unknown && config.mode !== 'mock')) return;
    if (intent.current && Date.now() >= intent.current.expires) { intent.current = undefined; setExpired(true); setError('Hết thời gian giữ mật khẩu cho retry. Cần kiểm tra Backend; không tạo lại tự động.'); return; }
    if (!intent.current) {
      if (unknown) return;
      if (!username.trim() || password.length < 8) { setError('Username bắt buộc; mật khẩu tối thiểu 8 ký tự.'); return; }
      intent.current = { body: { username: username.trim(), password, role }, key: crypto.randomUUID(), expires: Date.now() + 900000 };
    }
    const operation = intent.current; const controller = new AbortController(); active.current = controller;
    setPassword(''); setPending(true); setError(''); setSuccess('');
    try {
      const user = await data.adminUsers.create(operation.body, { idempotencyKey: operation.key, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      if (controller.signal.aborted) return;
      intent.current = undefined; setUnknown(false); setUsername(''); setSuccess(`Server đã tạo tài khoản ${user.username}.`); changed();
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(explain(cause));
        // Definitive validation/auth refusals allow correction; conflict/transport outcomes remain uncertain.
        const rejected = cause instanceof DataSourceError && ([400, 401, 403, 422].includes(cause.status ?? 0) || (cause.status === 409 && cause.error?.code === 'USERNAME_CONFLICT'));
        setUnknown(!rejected);
        if (rejected || config.mode !== 'mock') intent.current = undefined;
      }
    } finally { if (!controller.signal.aborted) { active.current = undefined; setPending(false); } }
  }
  return <section><h2>Tạo tài khoản</h2><form onSubmit={e => { e.preventDefault(); void submit(); }}><Field label="Username mới" autoComplete="off" value={username} disabled={pending || unknown} onChange={e => setUsername(e.target.value)} /><Field label="Mật khẩu mới" type="password" autoComplete="new-password" value={password} disabled={pending || unknown} onChange={e => setPassword(e.target.value)} /><label className="field">Quyền tài khoản mới<select aria-label="Quyền tài khoản mới" value={role} disabled={pending || unknown} onChange={e => setRole(e.target.value as typeof role)}><option value="analyst">analyst</option><option value="admin">admin</option></select></label><Button type="submit" disabled={expired || pending || (unknown && config.mode !== 'mock')}>{pending ? 'Đang tạo…' : unknown ? 'Thử lại tạo cùng key' : 'Tạo user'}</Button></form>{unknown && <p role="alert">Chưa xác nhận kết quả tạo. Không tự gửi lại. {config.mode === 'mock' ? 'Mock giữ nguyên key/payload trong RAM tối đa 15 phút để retry.' : 'API thật chưa chốt retention; retry đang khóa. Kiểm tra danh sách và đối soát Backend.'}</p>}{error && <p role="alert">{error}</p>}{success && <p role="status">{success}</p>}</section>;
}
function EditUser({ user, changed }: { user: UserPublic; changed: (u: UserPublic) => void }) {
  const { data, session } = useServices();
  const [role, setRole] = useState(user.role), [isActive, setActive] = useState(user.isActive);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => active.current?.abort(), []);
  const dirty = role !== user.role || isActive !== user.isActive;
  useBlocker({ shouldBlockFn: () => dirty && !window.confirm('Bỏ thay đổi tài khoản chưa lưu?'), enableBeforeUnload: dirty });
  async function save() {
    if (active.current || !dirty) return;
    const self = session.store.getState().user?.id === user.id;
    if (self && !window.confirm('Bạn đang thay đổi tài khoản của chính mình. Quyền truy cập/phiên có thể thay đổi. Tiếp tục?')) return;
    const controller = new AbortController(); active.current = controller; setPending(true); setError(''); setSaved(false);
    try {
      const result = await data.adminUsers.update(user.id, { ...(role !== user.role ? { role } : {}), ...(isActive !== user.isActive ? { isActive } : {}) }, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      if (controller.signal.aborted) return;
      if (result.id !== user.id) throw new Error('Response ID không khớp');
      setRole(result.role); setActive(result.isActive); changed(result); setSaved(true);
      if (self) { if (!result.isActive) session.logout(); else await session.restore(data); }
    } catch (cause) { if (!controller.signal.aborted) setError(explain(cause)); }
    finally { if (!controller.signal.aborted) { active.current = undefined; setPending(false); } }
  }
  return <section><h2>Sửa {user.username}</h2><p>ID: {user.id}. Chính sách admin cuối cùng/tự hạ quyền do Backend quyết định.</p><label className="field">Role<select aria-label="Role" disabled={pending} value={role} onChange={e => { setRole(e.target.value as typeof role); setSaved(false); }}><option>analyst</option><option>admin</option></select></label><label><input type="checkbox" checked={isActive} disabled={pending} onChange={e => { setActive(e.target.checked); setSaved(false); }} /> Đang hoạt động</label><Button disabled={pending || !dirty} onClick={() => { void save(); }}>Lưu tài khoản</Button>{error && <><p role="alert">{error} Bản sửa được giữ; lỗi mạng không chứng minh Server chưa lưu.</p><Button variant="secondary" onClick={() => { if (!dirty || window.confirm('Kiểm tra phiên sẽ bỏ bản sửa chưa lưu. Tiếp tục?')) void session.restore(data); }}>Kiểm tra lại quyền hiện tại</Button></>}{saved && <p role="status">Server đã xác nhận cập nhật tài khoản.</p>}</section>;
}
export function AdminUsersPage() {
  const { data, session } = useServices();
  const [sort, setSort] = useState<'username:asc' | 'username:desc'>('username:asc'), [revision, refresh] = useState(0);
  const [selected, select] = useState<UserPublic>();
  const createDirty = useRef(false);
  const canLeaveCreate = () => !createDirty.current || window.confirm('Bỏ form tạo user? Thao tác đã gửi có thể vẫn được xử lý; ngữ cảnh trong RAM sẽ bị xóa.');
  const pager = useMemo(() => createCursorPager(data.adminUsers.list), [data]);
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot);
  useEffect(() => { void pager.setQuery({ sort, limit: 100 }); return () => pager.dispose(); }, [pager, sort, revision]);
  return <><PageTitle eyebrow="ADMIN" title="Quản lý tài khoản" description="Quản lý username, role và trạng thái hoạt động." /><section className="card analysis-page">{selected ? <><EditUser key={selected.id} user={selected} changed={u => { select(u); refresh(v => v + 1); }} /><Button variant="secondary" onClick={() => { if (window.confirm('Về danh sách? Thay đổi chưa lưu sẽ bị bỏ.')) select(undefined); }}>Về danh sách user</Button></> : <><CreateUser dirtyRef={createDirty} changed={() => refresh(v => v + 1)} /><h2>Danh sách user</h2><label className="field">Sắp xếp user<select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="username:asc">Username A → Z</option><option value="username:desc">Username Z → A</option></select></label><Button variant="secondary" onClick={() => refresh(v => v + 1)}>Làm mới users</Button>{state.status === 'loading' && <LoadingState />}{state.status === 'error' && <><ErrorState message={errorMessage(state.error)} retry={() => { void pager.retry(); }} /><Button onClick={() => { if (canLeaveCreate()) void session.restore(data); }}>Kiểm tra lại quyền hiện tại</Button></>}{state.status === 'ready' && !state.data.length && <p>Không có user trong trang này.</p>}<div className="table-scroll"><table><thead><tr><th>Username</th><th>Role</th><th>Hoạt động</th><th>Sửa</th></tr></thead><tbody>{state.data.map(user => <tr key={user.id}><td>{user.username}</td><td>{user.role}</td><td>{user.isActive ? 'Có' : 'Không'}</td><td><Button onClick={() => { if (canLeaveCreate()) select(user); }}>Sửa {user.username}</Button></td></tr>)}</tbody></table></div><p>Đã tải {state.data.length} user{state.nextCursor ? ' · Còn trang' : ''}</p>{state.data.length >= 2000 && <p>Đã đạt giới hạn hiển thị 2000 user; đổi thứ tự để tra cứu tiếp.</p>}{state.nextCursor && <Button disabled={state.status === 'loading' || state.data.length >= 2000} onClick={() => { void pager.loadMore(); }}>Tải thêm users</Button>}</>}</section></>;
}
