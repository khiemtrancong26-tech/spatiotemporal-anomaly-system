import { useStore } from 'zustand';
import { useState } from 'react';
import { AuthGate, publicAuthPaths } from '../features/auth/pages';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { Icon } from '../shared/ui/icons';
import { Badge } from '../shared/ui/primitives';
import { useOfflineState, useServices } from './services';
import { WorkspaceHeaderContext } from './workspace-header';

export function AppShell() {
  const { config, mock, session, offline } = useServices();
  const local = useOfflineState();
  const auth = useStore(session.store);
  const role = auth.user?.role;
  const location = useLocation();
  const isAuth = publicAuthPaths.includes(location.pathname);
  const isWorkspace = location.pathname.startsWith('/workspace/');
  const [workspaceHeaderHost, setWorkspaceHeaderHost] = useState<HTMLDivElement | null>(null);
  const waiting = local.outbox.filter(item => item.state === 'pending').length;
  const conflicts = local.outbox.filter(item => item.state === 'conflict').length;
  const failures = local.outbox.filter(item => item.state === 'error').length;
  return <WorkspaceHeaderContext.Provider value={isWorkspace ? workspaceHeaderHost : null}><div className={`app-shell${isAuth ? ' app-shell--auth' : isWorkspace ? ' app-shell--workspace' : ''}`}>
    <a className="skip-link" href="#main-content">Đến nội dung chính</a>
    <aside className="sidebar">
      <Link to="/datasets" className="brand"><span className="brand-mark"><Icon name="layers" size={25} /></span><span>PM2.5<span className="brand-sub">EXPLORER</span></span></Link>
      <p className="nav-label">KHÔNG GIAN LÀM VIỆC</p>
      <nav aria-label="Điều hướng chính">
        <Link to="/datasets" title="Datasets" activeOptions={{ exact: true }} activeProps={{ className: 'active' }}><Icon name="dataset" /> Datasets</Link>
        <Link to="/datasets/import" title="Nhập dữ liệu" activeProps={{ className: 'active' }}><Icon name="upload" /> Nhập dữ liệu</Link>
        {role === 'admin' && <Link to="/admin/users" title="Quản lý tài khoản" activeProps={{ className: 'active' }}><Icon name="users" /> Quản lý tài khoản</Link>}
      </nav>
      <div className="sidebar-note"><span className="small-label">DỮ LIỆU KHÔNG GIAN–THỜI GIAN</span><p>Từ phép đo đến góc nhìn.</p><span>PM2.5 tại các trạm cố định</span></div>
      <div className="sidebar-footer"><span className="dot" /> Geospatial analytics</div>
    </aside>
    <div className="main-shell">
      <div className="shell-header">
      <header className="topbar"><span className="breadcrumb">Không gian làm việc <span>/</span> <strong>PM2.5 Explorer</strong></span><div className="topbar-actions"><Badge tone="blue">{config.mode === 'mock' ? 'Demo' : local.offline ? 'Offline · dữ liệu cục bộ' : 'Online'}</Badge>{auth.user ? <><span className="account-label"><span className="avatar" aria-hidden="true">{auth.user.username.slice(0, 2).toUpperCase()}</span><span>{auth.user.username}<small>{auth.user.role}</small></span></span><button className="button button--secondary logout-button" onClick={() => { if (offline) void offline.logout(); else session.logout(); }}>Đăng xuất</button></> : <Link to="/login" search={{ redirect: undefined }} className="text-link">Đăng nhập</Link>}</div></header>
      {isWorkspace && <div className="workspace-header-content" ref={setWorkspaceHeaderHost} />}
      </div>
      {mock && <div className="mock-banner"><div><strong>DỮ LIỆU MÔ PHỎNG</strong><span>Chỉ để phát triển giao diện. Không phải kết quả phân tích thực.</span></div></div>}
      {auth.user && (local.offline || local.needsLogin || local.storageError || local.shellError || local.syncing || local.syncError || waiting > 0 || conflicts > 0 || failures > 0) &&
        <div className="metadata-notice" role="status">
          {local.offline && <span>Đang xem dữ liệu cục bộ. </span>}
          {local.syncing && <span>Đang đồng bộ. </span>}
          {waiting > 0 && <span>Chờ đồng bộ ({waiting}). </span>}
          {conflicts > 0 && <span>Xung đột ({conflicts}). </span>}
          {failures > 0 && <span>Lỗi đồng bộ ({failures}). </span>}
          {local.syncError && <span>Lỗi đồng bộ. {local.syncError} </span>}
          {local.storageError && <span>IndexedDB không đọc hoặc lưu được một số dữ liệu. </span>}
          {local.shellError && <span>Chưa cài được bộ nhớ ứng dụng để mở lại offline. </span>}
          {local.needsLogin && <Link to="/login" search={{ redirect: location.pathname + location.searchStr }}>Đăng nhập lại để đồng bộ</Link>}
        </div>}
      <main id="main-content" tabIndex={-1}><AuthGate><Outlet /></AuthGate></main>
      <footer className="page-footer"><span>PM2.5 Explorer · {config.mode === 'mock' ? 'Bản phát triển với dữ liệu mô phỏng' : 'Kết nối API online'}</span><span>Thời gian hiển thị: UTC+07:00</span></footer>
    </div>
  </div></WorkspaceHeaderContext.Provider>;
}
