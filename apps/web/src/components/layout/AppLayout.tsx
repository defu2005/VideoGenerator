import { useQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { MOBILE_QUERY, useMediaQuery } from "../../hooks/useMediaQuery";
import { usePageVisible } from "../../hooks/usePageVisible";
import { HelpLink } from "../../features/help/HelpLink";
import { unreadCommentCount } from "../../services/commentsApi";
import { PageSkeleton } from "../ui/Skeleton";
import { Breadcrumbs } from "./Breadcrumbs";
import { CommandPalette } from "./CommandPalette";
import { NAV_SECTIONS, type NavItem } from "./nav";

const SECTION_KEY = "vg-nav-sections";

function readSections(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SECTION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

function CommentNavLink({ item }: { item: NavItem }) {
  const visible = usePageVisible();
  const unread = useQuery({
    queryKey: ["comments", "unread"],
    queryFn: unreadCommentCount,
    refetchInterval: visible ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
  const count = unread.data?.count ?? 0;
  return (
    <NavLink to={item.to} end={item.end}>
      {item.label}
      {count > 0 && <span className="nav-badge">{count > 99 ? "99+" : count}</span>}
    </NavLink>
  );
}

export function AppLayout() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sections, setSections] = useState<Record<string, boolean>>(readSections);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleSection(id: string) {
    setSections((current) => {
      const next = { ...current, [id]: current[id] === false };
      try {
        localStorage.setItem(SECTION_KEY, JSON.stringify(next));
      } catch {
        // The layout still works when storage is blocked.
      }
      return next;
    });
  }

  return (
    <div className="app-shell">
      {isMobile && drawerOpen ? (
        <button type="button" className="nav-backdrop" aria-label="Đóng điều hướng" onClick={() => setDrawerOpen(false)} />
      ) : null}
      <aside
        className={`sidebar${isMobile ? " is-drawer" : ""}${drawerOpen ? " is-open" : ""}`}
        aria-hidden={isMobile && !drawerOpen ? true : undefined}
      >
        <NavLink className="brand" to="/" aria-label="Video Agent home">
          <span className="brand-mark">V</span>
          <span>Video Agent</span>
        </NavLink>
        <nav className="primary-nav" aria-label="Main navigation">
          {NAV_SECTIONS.map((section) => {
            const open = sections[section.id] !== false;
            return (
              <div key={section.id} className="nav-section">
                <button
                  type="button"
                  className="nav-section-toggle"
                  aria-expanded={open}
                  onClick={() => toggleSection(section.id)}
                >
                  {section.label}
                </button>
                {open && (
                  <div className="nav-section-items">
                    {section.items.map((item) => (
                      item.badge === "comments"
                        ? <CommentNavLink key={item.to} item={item} />
                        : <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">Bảng điều khiển <span>v0.1</span></div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="topbar-start">
            {isMobile ? (
              <button
                type="button"
                className="button button-secondary"
                aria-label="Mở điều hướng"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
              >
                Menu
              </button>
            ) : null}
            <span className="topbar-label">Không gian làm việc</span>
          </div>
          <div className="topbar-end">
            <HelpLink />
            <button type="button" className="button button-secondary" onClick={() => setPaletteOpen(true)}>
              Tìm nhanh
            </button>
            <span className="connection-indicator"><i /> Máy cục bộ</span>
          </div>
        </header>
        <main className="page-content">
          <Breadcrumbs />
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
