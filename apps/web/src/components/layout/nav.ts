export type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  badge?: "comments";
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
      { to: "/", label: "Bảng điều khiển", end: true },
      { to: "/assistant", label: "Trợ lý AI" },
    ],
  },
  {
    id: "content",
    label: "Nội dung",
    items: [
      { to: "/profiles", label: "Hồ sơ" },
      { to: "/projects", label: "Dự án" },
      { to: "/publish/calendar", label: "Lịch đăng" },
      { to: "/comments", label: "Bình luận", badge: "comments" },
    ],
  },
  {
    id: "results",
    label: "Kết quả",
    items: [
      { to: "/analytics", label: "Phân tích" },
      { to: "/finance", label: "Tài chính" },
      { to: "/usage", label: "Mức dùng" },
    ],
  },
  {
    id: "settings",
    label: "Cài đặt",
    items: [
      { to: "/settings/ai", label: "Mô hình AI" },
      { to: "/settings/render", label: "Render" },
      { to: "/settings/image-sources", label: "Nguồn ảnh" },
      { to: "/settings/web-image", label: "Nguồn ảnh web" },
      { to: "/settings/tts", label: "Giọng đọc (TTS)" },
      { to: "/settings/notifications", label: "Thông báo" },
      { to: "/settings/guidelines", label: "Định hướng nội dung" },
    ],
  },
  {
    id: "help",
    label: "Trợ giúp",
    items: [{ to: "/help", label: "Hướng dẫn" }],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);
