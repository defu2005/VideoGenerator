import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router-dom";
import { unreadCommentCount } from "../../services/commentsApi";

function CommentNavLink() {
  const unread = useQuery({
    queryKey: ["comments", "unread"],
    queryFn: unreadCommentCount,
    refetchInterval: 60_000,
  });
  const count = unread.data?.count ?? 0;
  return (
    <NavLink to="/comments">
      Bình luận
      {count > 0 && <span className="nav-badge">{count > 99 ? "99+" : count}</span>}
    </NavLink>
  );
}

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
          <NavLink to="/assistant">Trợ lý AI</NavLink>
          <NavLink to="/projects">Projects</NavLink>
          <NavLink to="/profiles">Hồ sơ</NavLink>
          <NavLink to="/publish/calendar">Lịch đăng</NavLink>
          <NavLink to="/analytics">Thống kê</NavLink>
          <NavLink to="/finance">Doanh thu</NavLink>
          <CommentNavLink />
          <NavLink to="/settings/ai">Mô hình AI</NavLink>
          <NavLink to="/settings/render">Render</NavLink>
          <NavLink to="/settings/image-sources">Nguồn ảnh</NavLink>
          <NavLink to="/settings/web-image">Nguồn ảnh web</NavLink>
          <NavLink to="/settings/notifications">Thông báo</NavLink>
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
