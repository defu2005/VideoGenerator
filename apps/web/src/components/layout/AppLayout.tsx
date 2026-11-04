import { NavLink, Outlet } from "react-router-dom";

export function AppLayout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink className="brand" to="/" aria-label="Video Agent home">
          <span className="brand-mark">V</span>
          <span>Video Agent</span>
        </NavLink>
        <div className="mobile-brand"><span className="brand-mark">V</span> Video Agent</div>
        <nav className="primary-nav" aria-label="Main navigation">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/projects">Projects</NavLink>
          <NavLink to="/settings/ai">Mô hình AI</NavLink>
          <NavLink to="/settings/render">Render</NavLink>
          <NavLink to="/settings/web-image">Nguồn ảnh web</NavLink>
          <NavLink to="/settings/guidelines">Định hướng nội dung</NavLink>
          <NavLink to="/usage">Mức dùng</NavLink>
        </nav>
        <div className="sidebar-footer">Control Panel <span>v0.1</span></div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <span className="topbar-label">Project workspace</span>
          <span className="connection-indicator"><i /> Local workspace</span>
        </header>
        <main className="page-content"><Outlet /></main>
      </div>
    </div>
  );
}
