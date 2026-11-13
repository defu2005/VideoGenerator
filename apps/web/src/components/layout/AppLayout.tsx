import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { MOBILE_QUERY, useMediaQuery } from "../../hooks/useMediaQuery";
import { usePageVisible } from "../../hooks/usePageVisible";
import { HelpLink } from "../../features/help/HelpLink";
import { unreadCommentCount } from "../../services/commentsApi";
import { apiRequest, fetchSessionUser, signOut } from "../../services/apiClient";
import { fetchMe, listMyWorkspaces, setActiveWorkspace } from "../../services/meApi";
import { useToast } from "../ui/Toast";
import { Icon } from "../ui/Icon";
import { PageSkeleton } from "../ui/Skeleton";
import { Breadcrumbs } from "./Breadcrumbs";
import { CommandPalette } from "./CommandPalette";
import { NAV_SECTIONS, type NavItem } from "./nav";

const SECTION_KEY = "vg-nav-sections";
const THEME_KEY = "vg-theme";

function readTheme(): "light" | "dark" {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === "dark" || raw === "light") return raw;
  } catch {
    // Fall back to system preference
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

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
      {item.icon ? <Icon name={item.icon} size={16} className="nav-icon" /> : null}
      <span>{item.label}</span>
      {count > 0 && <span className="nav-badge">{count > 99 ? "99+" : count}</span>}
    </NavLink>
  );
}

export function StopAutonomyButton() {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: ["autonomy", "app"],
    queryFn: () => apiRequest<{ effective?: { level?: string } }>("/autonomy/app"),
  });
  const stop = useMutation({
    mutationFn: () => apiRequest("/autonomy/stop", { method: "POST", body: "{}" }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["autonomy"] }); },
  });
  if (status.data?.effective?.level !== "supervised" && status.data?.effective?.level !== "autonomous") return null;
  return <button type="button" className="button button-danger" onClick={() => stop.mutate()} disabled={stop.isPending}>Dừng tự vận hành</button>;
}

function EnvironmentChip() {
  const meta = useQuery({
    queryKey: ["skill-report-meta"],
    queryFn: () => apiRequest<{ environment: string }>("/skill-reports/meta"),
  });
  if (!meta.data?.environment) return null;
  return <span className="connection-indicator">Môi trường {meta.data.environment}</span>;
}

export function AppLayout() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const location = useLocation();
  const session = useQuery({ queryKey: ["auth-session"], queryFn: fetchSessionUser, retry: false });
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false });
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: listMyWorkspaces, retry: false });
  const toast = useToast();
  const queryClient = useQueryClient();
  const switcherRef = useRef<HTMLDetailsElement>(null);
  const allowed = me.data ? new Set(me.data.allowed) : null;
  useEffect(() => {
    const onForbidden = (event: Event) => toast.error(String((event as CustomEvent).detail ?? "Bạn không có quyền làm việc này."));
    const onRequired = () => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      if (switcherRef.current) switcherRef.current.open = true;
    };
    window.addEventListener("vg:forbidden", onForbidden);
    window.addEventListener("vg:workspace-required", onRequired);
    return () => {
      window.removeEventListener("vg:forbidden", onForbidden);
      window.removeEventListener("vg:workspace-required", onRequired);
    };
  }, [toast, queryClient]);
  const switchWorkspace = useMutation({
    mutationFn: setActiveWorkspace,
    onSuccess: () => { window.location.reload(); },
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sections, setSections] = useState<Record<string, boolean>>(readSections);
  const [theme, setTheme] = useState<"light" | "dark">(readTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  function toggleTheme() {
    setTheme((cur) => (cur === "light" ? "dark" : "light"));
  }

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
        <NavLink className="brand" to="/" aria-label="Trang chủ">
          <span className="brand-mark">V</span>
          <span>Video Agent</span>
        </NavLink>
        <nav className="primary-nav" aria-label="Điều hướng chính">
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
                  <span>{section.label}</span>
                  <Icon name="chevronDown" size={14} className={`nav-section-chevron ${open ? "is-open" : ""}`} />
                </button>
                {open && (
                  <div className="nav-section-items">
                    {section.items.filter((item) => !item.needs || !allowed || allowed.has(item.needs)).map((item) => (
                      item.badge === "comments"
                        ? <CommentNavLink key={item.to} item={item} />
                        : (
                          <NavLink key={item.to} to={item.to} end={item.end}>
                            {item.icon ? <Icon name={item.icon} size={16} className="nav-icon" /> : null}
                            <span>{item.label}</span>
                          </NavLink>
                        )
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        {session.data ? (
          <div className="sidebar-user">
            <span className="sidebar-user-name">{session.data.name}</span>
            <details className="user-menu" ref={switcherRef}>
              <summary>Tài khoản</summary>
              {(workspaces.data?.length ?? 0) > 1 ? (
                <label className="workspace-switcher">
                  <span>Không gian làm việc</span>
                  <select
                    value={me.data?.workspace.id ?? ""}
                    onChange={(event) => switchWorkspace.mutate(event.target.value)}
                  >
                    {!me.data ? <option value="">Chọn…</option> : null}
                    {workspaces.data?.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
                  </select>
                </label>
              ) : null}
              <NavLink to="/account" className="user-menu-link">Tài khoản của tôi</NavLink>
              <button type="button" onClick={() => { void signOut(); }}>Đăng xuất</button>
            </details>
          </div>
        ) : null}
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
                <Icon name="menu" size={16} />
                <span>Menu</span>
              </button>
            ) : null}
            <span className="topbar-label">Không gian làm việc</span>
          </div>
          <div className="topbar-end">
            <button
              type="button"
              className="button button-secondary theme-toggle-btn"
              onClick={toggleTheme}
              aria-label={theme === "light" ? "Chuyển sang giao diện tối" : "Chuyển sang giao diện sáng"}
              title={theme === "light" ? "Giao diện tối" : "Giao diện sáng"}
            >
              <Icon name={theme === "light" ? "moon" : "sun"} size={16} />
            </button>
            <StopAutonomyButton />
            <HelpLink />
            <button type="button" className="button button-secondary" onClick={() => setPaletteOpen(true)}>
              <Icon name="search" size={14} />
              <span>Tìm nhanh</span>
            </button>
            <EnvironmentChip />
            <span className="connection-indicator"><i /> Máy cục bộ</span>
          </div>
        </header>
        <main className="page-content">
          <Breadcrumbs />
          <Suspense fallback={<PageSkeleton />}>
            {me.data?.twoFactorRequired && location.pathname !== "/account" ? <Navigate to="/account" replace /> : <Outlet />}
          </Suspense>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
