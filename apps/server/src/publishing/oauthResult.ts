import { redactExportText } from "@vg/shared";

export function oauthFailureMessage(code: string, description: string, redirectUri: string): string {
  const detail = redactExportText(description).toLowerCase();
  if (code === "org_internal" || code === "admin_policy_enforced"
      || (code === "access_denied" && /test user|testing|testers/.test(detail))) {
    return "Thêm email này vào Test users trong OAuth consent screen.";
  }
  switch (code) {
    case "access_denied": return "Bạn đã từ chối quyền truy cập. Bấm Đăng nhập lại và chọn Cho phép.";
    case "invalid_state": return "Phiên đăng nhập đã hết hạn (hoặc app vừa khởi động lại). Mở lại trang đăng nhập từ app.";
    case "invalid_client":
    case "unauthorized_client": return "Client ID hoặc Client Secret chưa đúng. Mở lại bước Ứng dụng nhà phát triển và nhập lại.";
    case "redirect_uri_mismatch": return `Thêm đúng redirect URI này vào ứng dụng: ${redirectUri}`;
    case "invalid_grant": return "Mã đăng nhập đã dùng hoặc hết hạn, hãy đăng nhập lại.";
    default: return "Không hoàn tất được đăng nhập (oauth_error). Quay lại app và thử đăng nhập lại.";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function oauthResultHtml(title: string, message: string, accountsUrl: string, editAppUrl?: string): string {
  const safeTitle = escapeHtml(redactExportText(title));
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title><style>body{font:1rem system-ui,sans-serif;margin:3rem auto;padding:0 1rem;max-width:42rem;line-height:1.6}a,button{margin-right:1rem}</style>
<main><h1>${safeTitle}</h1><p>${escapeHtml(message)}</p><button type="button" onclick="window.close()">Đóng tab</button>
<a href="${escapeHtml(accountsUrl)}">Về trang Tài khoản</a>${editAppUrl ? `<a href="${escapeHtml(editAppUrl)}">Sửa ứng dụng</a>` : ""}</main></html>`;
}
