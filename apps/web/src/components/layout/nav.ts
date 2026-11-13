import type { IconName } from "../ui/Icon";

export type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  badge?: "comments";
  icon?: IconName;
  /** Action the server must allow (from /api/me) for the item to show. */
  needs?: string;
};

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "overview",
    label: "Tổng quan",
    items: [
      { to: "/", label: "Bảng điều khiển", end: true, icon: "dashboard" },
      { to: "/assistant", label: "Trợ lý AI", icon: "assistant" },
      { to: "/operator", label: "Agent operator", icon: "operator", needs: "operator.use" },
      { to: "/operator/journal", label: "Nhật ký tự vận hành", icon: "operator", needs: "operator.use" },
    ],
  },
  {
    id: "content",
    label: "Nội dung",
    items: [
      { to: "/profiles", label: "Hồ sơ", icon: "profiles" },
      { to: "/accounts", label: "Tài khoản nền tảng", icon: "users" },
      { to: "/projects", label: "Dự án", icon: "projects" },
      { to: "/publish/calendar", label: "Lịch đăng", icon: "calendar" },
      { to: "/comments", label: "Bình luận", badge: "comments", icon: "comments" },
    ],
  },
  {
    id: "results",
    label: "Kết quả",
    items: [
      { to: "/analytics", label: "Phân tích", icon: "analytics" },
      { to: "/reports", label: "Báo cáo thử nghiệm", icon: "analytics" },
      { to: "/finance", label: "Tài chính", icon: "finance", needs: "finance.read" },
      { to: "/usage", label: "Mức dùng", icon: "usage" },
    ],
  },
  {
    id: "settings",
    label: "Cài đặt",
    items: [
      { to: "/settings/connections", label: "Kết nối", icon: "plug", needs: "channel.manage" },
      { to: "/settings/ai", label: "Mô hình AI", icon: "bot", needs: "settings.write" },
      { to: "/providers", label: "Nhà cung cấp AI", icon: "server", needs: "settings.write" },
      { to: "/settings/render", label: "Render", icon: "sliders" },
      { to: "/settings/image-sources", label: "Nguồn ảnh", icon: "image" },
      { to: "/settings/web-image", label: "Nguồn ảnh web", icon: "globe" },
      { to: "/settings/tts", label: "Giọng đọc (TTS)", icon: "mic" },
      { to: "/settings/notifications", label: "Thông báo", icon: "bell" },
      { to: "/settings/knowledge", label: "Tri thức", icon: "shield" },
      { to: "/settings/guidelines", label: "Định hướng nội dung", icon: "shield" },
      { to: "/team", label: "Nhóm", icon: "users", needs: "members.manage" },
      { to: "/audit", label: "Nhật ký hoạt động", icon: "shield", needs: "audit.read" },
      { to: "/nodes", label: "Máy worker", icon: "server", needs: "nodes.manage" },
    ],
  },
  {
    id: "help",
    label: "Trợ giúp",
    items: [{ to: "/help", label: "Hướng dẫn", icon: "helpCircle" }],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);
