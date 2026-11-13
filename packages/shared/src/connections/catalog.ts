import { z } from "zod";

/**
 * Secrets the user can save in the app (encrypted vault). Each maps to its `.env` fallback.
 * A platform developer app is one JSON secret `{ clientId, clientSecret }` with two env names.
 */
export const STATIC_SECRET_IDS = [
  "llm.anthropic.apiKey",
  "llm.gemini.apiKey",
  "llm.openai.apiKey",
  "llm.openrouter.apiKey",
  "llm.deepseek.apiKey",
  "llm.groq.apiKey",
  "llm.omniroute.apiKey",
  "llm.opencode.apiKey",
  "llm.custom.apiKey",
  "llm.remote-ollama.token",
  "image.pexels.apiKey",
  "image.pixabay.apiKey",
  "image.unsplash.accessKey",
  "image.smithsonian.apiKey",
  "image.europeana.apiKey",
  "image.flickr.apiKey",
  "image.openverse.clientId",
  "image.openverse.clientSecret",
  "web.brave.apiKey",
  "platform.youtube.app",
  "platform.tiktok.app",
  "platform.meta.app",
] as const;
export type StaticSecretId = (typeof STATIC_SECRET_IDS)[number];

/** Extra OpenAI-compatible providers the user adds in the app. They have no `.env` fallback. */
export const CUSTOM_PROVIDER_SLUG = /^[a-z0-9][a-z0-9-]{0,30}$/;
export type CustomSecretId = `llm.custom.${string}.apiKey`;
export type SecretId = StaticSecretId | CustomSecretId;

export const SECRET_ENV_NAMES: Record<StaticSecretId, readonly string[]> = {
  "llm.anthropic.apiKey": ["ANTHROPIC_API_KEY"],
  "llm.gemini.apiKey": ["GEMINI_API_KEY"],
  "llm.openai.apiKey": ["OPENAI_API_KEY"],
  "llm.openrouter.apiKey": ["OPENROUTER_API_KEY"],
  "llm.deepseek.apiKey": ["DEEPSEEK_API_KEY"],
  "llm.groq.apiKey": ["GROQ_API_KEY"],
  "llm.omniroute.apiKey": ["OMNIROUTE_API_KEY"],
  "llm.opencode.apiKey": ["OPENCODE_API_KEY"],
  "llm.custom.apiKey": ["CUSTOM_LLM_API_KEY"],
  "llm.remote-ollama.token": ["REMOTE_OLLAMA_TOKEN"],
  "image.pexels.apiKey": ["PEXELS_API_KEY"],
  "image.pixabay.apiKey": ["PIXABAY_API_KEY"],
  "image.unsplash.accessKey": ["UNSPLASH_ACCESS_KEY"],
  "image.smithsonian.apiKey": ["SMITHSONIAN_API_KEY"],
  "image.europeana.apiKey": ["EUROPEANA_API_KEY"],
  "image.flickr.apiKey": ["FLICKR_API_KEY"],
  "image.openverse.clientId": ["OPENVERSE_CLIENT_ID"],
  "image.openverse.clientSecret": ["OPENVERSE_CLIENT_SECRET"],
  "web.brave.apiKey": ["BRAVE_SEARCH_API_KEY"],
  "platform.youtube.app": ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
  "platform.tiktok.app": ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  "platform.meta.app": ["META_APP_ID", "META_APP_SECRET"],
};

export function isStaticSecretId(value: string): value is StaticSecretId {
  return (STATIC_SECRET_IDS as readonly string[]).includes(value);
}

export function isSecretId(value: string): value is SecretId {
  if (isStaticSecretId(value)) return true;
  const match = /^llm\.custom\.([^.]+)\.apiKey$/.exec(value);
  return Boolean(match && CUSTOM_PROVIDER_SLUG.test(match[1]!));
}

export function customSecretId(slug: string): CustomSecretId {
  return `llm.custom.${slug}.apiKey`;
}

/** Platform id → developer-app secret. Facebook and Instagram share the Meta app. */
export function platformAppSecretId(platform: string): StaticSecretId | null {
  if (platform === "youtube") return "platform.youtube.app";
  if (platform === "tiktok") return "platform.tiktok.app";
  if (platform === "facebook_reels" || platform === "instagram_reels") return "platform.meta.app";
  return null;
}

const GOOGLE_CLIENT_ID = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
export function validatePlatformAppInput(platform: string, input: { clientId: string; clientSecret: string }) {
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  const errors: { clientId?: string; clientSecret?: string } = {};
  const warnings: string[] = [];
  const location = platform === "youtube" ? "Google Cloud → Credentials → OAuth 2.0 Client IDs"
    : platform === "tiktok" ? "TikTok for Developers → Manage apps" : "Meta for Developers → App settings";
  for (const [field, value] of Object.entries({ clientId, clientSecret }) as [keyof typeof errors, string][]) {
    const label = field === "clientId" ? "Client ID" : "Client Secret";
    if (value.includes("@")) errors[field] = `Đây là email, không phải ${label}. ${label} nằm trong ${location}.`;
    else if (!value) errors[field] = `Nhập ${label}.`;
    else if (/\s/.test(value)) errors[field] = `${label} không được có khoảng trắng hoặc xuống dòng.`;
  }
  if (platform === "youtube") {
    if (!errors.clientId && !GOOGLE_CLIENT_ID.test(clientId)) {
      errors.clientId = clientId.startsWith("GOCSPX-") ? "Bạn có thể đã nhập Client Secret vào ô Client ID."
        : "Client ID không đúng dạng của Google (đuôi .apps.googleusercontent.com).";
    }
    if (!errors.clientSecret && GOOGLE_CLIENT_ID.test(clientSecret)) errors.clientSecret = "Bạn đã nhập Client ID vào ô Client Secret.";
    if (!errors.clientSecret && !clientSecret.startsWith("GOCSPX-")) warnings.push("Client Secret không bắt đầu bằng GOCSPX-. Secret Google cũ có thể dùng dạng khác.");
  }
  if (platformAppSecretId(platform) === "platform.meta.app" && !errors.clientId && !/^\d+$/.test(clientId)) {
    errors.clientId = "Meta App ID chỉ gồm chữ số.";
  }
  return { ok: !errors.clientId && !errors.clientSecret, errors, warnings };
}

export const YOUTUBE_OAUTH_HELP = [
  { code: "invalid_client", titleVi: "401 invalid_client", fixVi: "Kiểm tra lại Client ID và Client Secret trong ứng dụng Google Cloud." },
  { code: "redirect_uri_mismatch", titleVi: "400 redirect_uri_mismatch", fixVi: "Chép đúng Redirect URI của app vào Authorized redirect URIs." },
  { code: "access_denied", titleVi: "403 access_denied / chưa là test user", fixVi: "Thêm email đăng nhập vào Test users, rồi đăng nhập lại và chọn Cho phép." },
];

export const SecretSourceSchema = z.enum(["app", "env", "none"]);
export type SecretSource = z.infer<typeof SecretSourceSchema>;

export const SecretStatusSchema = z.object({
  id: z.string(),
  configured: z.boolean(),
  source: SecretSourceSchema,
  hint: z.string().nullable(),
  updatedAt: z.string().nullable(),
  error: z.literal("UNREADABLE").optional(),
  envNames: z.array(z.string()),
}).strict();
export type SecretStatus = z.infer<typeof SecretStatusSchema>;

export type ConnectionKind = "llm" | "image" | "web" | "platform";

export type ConnectionCatalogEntry = {
  id: string;
  kind: ConnectionKind;
  label: string;
  /** Secret ids this connection uses (empty when it needs none). */
  secrets: StaticSecretId[];
  keyPageUrl: string | null;
  howToVi: string[];
  noteVi?: string;
  troubleshootVi?: typeof YOUTUBE_OAUTH_HELP;
  pricing: "free" | "freemium" | "paid" | "local";
  vision?: boolean;
  supportsLogin?: boolean;
};

const step = (...lines: string[]) => lines;

export const CONNECTION_CATALOG: ConnectionCatalogEntry[] = [
  { id: "anthropic", kind: "llm", label: "Anthropic API", secrets: ["llm.anthropic.apiKey"], keyPageUrl: "https://console.anthropic.com/settings/keys", pricing: "paid", vision: true,
    howToVi: step("Đăng nhập Anthropic Console.", "Vào API Keys → Create Key.", "Dán key vào ô bên dưới.") },
  { id: "gemini", kind: "llm", label: "Gemini API", secrets: ["llm.gemini.apiKey"], keyPageUrl: "https://aistudio.google.com/app/apikey", pricing: "freemium", vision: true,
    howToVi: step("Mở Google AI Studio.", "Bấm Create API key.", "Dán key vào ô bên dưới.") },
  { id: "openai", kind: "llm", label: "OpenAI API", secrets: ["llm.openai.apiKey"], keyPageUrl: "https://platform.openai.com/api-keys", pricing: "paid", vision: true,
    howToVi: step("Đăng nhập OpenAI Platform.", "Tạo secret key mới.", "Dán key vào ô bên dưới.") },
  { id: "openrouter", kind: "llm", label: "OpenRouter", secrets: ["llm.openrouter.apiKey"], keyPageUrl: "https://openrouter.ai/settings/keys", pricing: "freemium", vision: true, supportsLogin: true,
    howToVi: step("Bấm Đăng nhập để OpenRouter tự cấp key cho app.", "Hoặc tạo key trong trang Keys rồi dán vào đây.") },
  { id: "deepseek", kind: "llm", label: "DeepSeek", secrets: ["llm.deepseek.apiKey"], keyPageUrl: "https://platform.deepseek.com/api_keys", pricing: "paid",
    howToVi: step("Đăng nhập DeepSeek Platform.", "Tạo API key.", "Dán key vào ô bên dưới.") },
  { id: "groq", kind: "llm", label: "Groq", secrets: ["llm.groq.apiKey"], keyPageUrl: "https://console.groq.com/keys", pricing: "freemium",
    howToVi: step("Đăng nhập Groq Console.", "Create API Key.", "Dán key vào ô bên dưới.") },
  { id: "omniroute", kind: "llm", label: "OmniRoute (gateway cục bộ)", secrets: ["llm.omniroute.apiKey"], keyPageUrl: "http://127.0.0.1:20128/dashboard", pricing: "local", vision: true,
    howToVi: step("Chạy OmniRoute trên máy.", "Tạo endpoint key trong dashboard của OmniRoute.", "Dán key và địa chỉ (nếu khác cổng 20128).") },
  { id: "opencode", kind: "llm", label: "OpenCode Zen", secrets: ["llm.opencode.apiKey"], keyPageUrl: "https://opencode.ai/auth", pricing: "paid",
    howToVi: step("Đăng nhập OpenCode Zen console.", "Tạo API key.", "Dán key; gói Go dùng địa chỉ https://opencode.ai/zen/go/v1.") },
  { id: "custom", kind: "llm", label: "OpenAI-compatible tùy chỉnh", secrets: ["llm.custom.apiKey"], keyPageUrl: null, pricing: "paid",
    howToVi: step("Nhập địa chỉ API (kết thúc bằng /v1).", "Dán key nếu nhà cung cấp yêu cầu.") },
  { id: "ollama", kind: "llm", label: "Ollama", secrets: [], keyPageUrl: "https://ollama.com/download", pricing: "local",
    howToVi: step("Cài và chạy Ollama.", "Nhập địa chỉ (mặc định http://127.0.0.1:11434/v1) và model.") },
  { id: "remote-ollama", kind: "llm", label: "Ollama từ xa", secrets: ["llm.remote-ollama.token"], keyPageUrl: null, pricing: "local",
    howToVi: step("Mở tunnel HTTPS tới Ollama.", "Nhập địa chỉ và token của tunnel.") },
  { id: "pexels", kind: "image", label: "Pexels", secrets: ["image.pexels.apiKey"], keyPageUrl: "https://www.pexels.com/api/new/", pricing: "free",
    howToVi: step("Đăng nhập Pexels.", "Mở trang API và yêu cầu key.", "Dán key vào ô bên dưới.") },
  { id: "pixabay", kind: "image", label: "Pixabay", secrets: ["image.pixabay.apiKey"], keyPageUrl: "https://pixabay.com/api/docs/", pricing: "free",
    howToVi: step("Đăng nhập Pixabay.", "Key nằm trong mục Parameters của trang API.", "Dán key vào ô bên dưới.") },
  { id: "unsplash", kind: "image", label: "Unsplash", secrets: ["image.unsplash.accessKey"], keyPageUrl: "https://unsplash.com/oauth/applications", pricing: "free",
    howToVi: step("Tạo ứng dụng trên Unsplash Developers.", "Sao chép Access Key.", "Dán vào ô bên dưới.") },
  { id: "smithsonian", kind: "image", label: "Smithsonian", secrets: ["image.smithsonian.apiKey"], keyPageUrl: "https://api.data.gov/signup/", pricing: "free",
    howToVi: step("Đăng ký key api.data.gov.", "Key được gửi qua email.", "Dán vào ô bên dưới.") },
  { id: "europeana", kind: "image", label: "Europeana", secrets: ["image.europeana.apiKey"], keyPageUrl: "https://pro.europeana.eu/pages/get-api", pricing: "free",
    howToVi: step("Đăng ký key Europeana API.", "Dán key vào ô bên dưới.") },
  { id: "flickr", kind: "image", label: "Flickr", secrets: ["image.flickr.apiKey"], keyPageUrl: "https://www.flickr.com/services/apps/create/", pricing: "free",
    howToVi: step("Tạo ứng dụng Flickr (non-commercial).", "Sao chép Key.", "Dán vào ô bên dưới.") },
  { id: "openverse", kind: "image", label: "Openverse", secrets: ["image.openverse.clientId", "image.openverse.clientSecret"], keyPageUrl: "https://api.openverse.org/v1/#tag/auth", pricing: "free",
    howToVi: step("Không bắt buộc: Openverse vẫn chạy ẩn danh.", "Đăng ký client để có hạn mức cao hơn, rồi dán client id và secret.") },
  { id: "brave", kind: "web", label: "Brave Search", secrets: ["web.brave.apiKey"], keyPageUrl: "https://api-dashboard.search.brave.com/app/keys", pricing: "freemium",
    howToVi: step("Đăng ký Brave Search API (gói Free).", "Tạo key trong dashboard.", "Dán vào ô bên dưới.") },
  { id: "youtube", kind: "platform", label: "YouTube (Google Cloud)", secrets: ["platform.youtube.app"], keyPageUrl: "https://console.cloud.google.com/apis/credentials", pricing: "free",
    howToVi: step(
      "Tạo hoặc chọn dự án trong Google Cloud.",
      "Bật YouTube Data API v3 trong APIs & Services → Library.",
      "Cấu hình màn hình đồng ý OAuth, chọn External và điền tên app, email.",
      "Thêm email đăng nhập của từng kênh vào Test users.",
      "Trong Credentials, tạo OAuth client ID loại Web application.",
      "Thêm Redirect URI bên dưới vào Authorized redirect URIs.",
      "Chép Client ID (đuôi .apps.googleusercontent.com) và Client Secret (thường bắt đầu GOCSPX-).",
    ),
    noteVi: "Ở chế độ Testing, refresh token cho YouTube hết hạn sau 7 ngày. Để bỏ giới hạn Testing, chọn Publish app và hoàn tất xác minh nếu Google yêu cầu. Quota tính theo dự án Google Cloud và dùng chung giữa các kênh. Chọn Chỉ hồ sơ này để dùng dự án riêng.",
    troubleshootVi: YOUTUBE_OAUTH_HELP },
  { id: "tiktok", kind: "platform", label: "TikTok for Developers", secrets: ["platform.tiktok.app"], keyPageUrl: "https://developers.tiktok.com/apps", pricing: "free",
    howToVi: step("Tạo app, thêm Login Kit và Content Posting API.", "Thêm redirect URI bên dưới.", "Sao chép Client key và Client secret.") },
  { id: "meta", kind: "platform", label: "Meta for Developers", secrets: ["platform.meta.app"], keyPageUrl: "https://developers.facebook.com/apps", pricing: "free",
    howToVi: step("Tạo app loại Business.", "Thêm Facebook Login và redirect URI bên dưới.", "Sao chép App ID và App secret.") },
];

export function connectionCatalogEntry(id: string): ConnectionCatalogEntry | undefined {
  return CONNECTION_CATALOG.find((entry) => entry.id === id);
}

export const LlmBuiltInProviderSettingSchema = z.object({
  enabled: z.boolean().default(true),
  baseUrl: z.string().url().regex(/^https?:\/\//).optional(),
  defaultModel: z.string().trim().min(1).max(200).optional(),
  embeddings: z.boolean().optional(),
  vision: z.boolean().optional(),
}).strict();

export const LlmCustomProviderSchema = z.object({
  slug: z.string().regex(CUSTOM_PROVIDER_SLUG),
  label: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().regex(/^https?:\/\//),
  defaultModel: z.string().trim().min(1).max(200).optional(),
  embeddings: z.boolean().optional(),
  vision: z.boolean().optional(),
  enabled: z.boolean().default(true),
}).strict();
export type LlmCustomProvider = z.infer<typeof LlmCustomProviderSchema>;

export const LlmCliSettingSchema = z.object({
  enabled: z.boolean(),
  path: z.string().trim().max(500).optional(),
  model: z.string().trim().max(200).optional(),
}).strict();

export const LlmConnectionSettingsSchema = z.object({
  providers: z.record(z.string(), LlmBuiltInProviderSettingSchema).default({}),
  custom: z.array(LlmCustomProviderSchema).max(20).default([]),
  cli: z.partialRecord(z.enum(["claude-cli", "copilot-cli", "antigravity-cli"]), LlmCliSettingSchema).default({}),
}).strict();
export type LlmConnectionSettings = z.infer<typeof LlmConnectionSettingsSchema>;

export const ConnectionCheckSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  models: z.number().int().nonnegative().optional(),
  checkedAt: z.string(),
}).strict();
export type ConnectionCheck = z.infer<typeof ConnectionCheckSchema>;
