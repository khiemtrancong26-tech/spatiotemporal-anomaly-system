import { useStore } from 'zustand';
import { useState } from 'react';
import { AuthGate, publicAuthPaths } from '../features/auth/pages';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { Icon } from '../shared/ui/icons';
import { Badge } from '../shared/ui/primitives';
import { useServices } from './services';
import { WorkspaceHeaderContext } from './workspace-header';

export function AppShell() {
  const { config, mock, session } = useServices();
  const auth = useStore(session.store);
  const role = auth.user?.role;
  const location = useLocation();
  const isAuth = publicAuthPaths.includes(location.pathname);
  const isWorkspace = location.pathname.startsWith('/workspace/');
  const [workspaceHeaderHost, setWorkspaceHeaderHost] = useState<HTMLDivElement | null>(null);
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
      <header className="topbar"><span className="breadcrumb">Không gian làm việc <span>/</span> <strong>PM2.5 Explorer</strong></span><div className="topbar-actions"><Badge tone="blue">{config.mode === 'mock' ? 'Demo' : 'Online'}</Badge>{auth.user ? <><span className="account-label"><span className="avatar" aria-hidden="true">{auth.user.username.slice(0, 2).toUpperCase()}</span><span>{auth.user.username}<small>{auth.user.role}</small></span></span><button className="button button--secondary logout-button" onClick={session.logout}>Đăng xuất</button></> : <Link to="/login" search={{ redirect: undefined }} className="text-link">Đăng nhập</Link>}</div></header>
      {isWorkspace && <div className="workspace-header-content" ref={setWorkspaceHeaderHost} />}
      </div>
      {mock && <div className="mock-banner"><div><strong>DỮ LIỆU MÔ PHỎNG</strong><span>Chỉ để phát triển giao diện. Không phải kết quả phân tích thực.</span></div></div>}
      <main id="main-content" tabIndex={-1}><AuthGate><Outlet /></AuthGate></main>
      <footer className="page-footer"><span>PM2.5 Explorer · {config.mode === 'mock' ? 'Bản phát triển với dữ liệu mô phỏng' : 'Kết nối API online'}</span><span>Thời gian hiển thị: UTC+07:00</span></footer>
    </div>
  </div></WorkspaceHeaderContext.Provider>;
}
