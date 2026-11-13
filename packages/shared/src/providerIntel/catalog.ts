import type { AccountStatus, ProviderCategory, ProviderOffer, ProviderStub } from "../schemas/providerIntel.js";
import { ProviderStubSchema } from "../schemas/providerIntel.js";

export const OFFER_API_KINDS = new Set<ProviderOffer["kind"]>([
  "permanent_free",
  "monthly_free",
  "daily_free",
  "signup_credit",
  "promo_credit",
  "referral_credit",
  "startup_credit",
  "grant",
  "free_models_rate_limited",
]);

export function offerCountsAsApi(offer: Pick<ProviderOffer, "kind" | "appliesTo">): boolean {
  return offer.kind !== "chatbot_only_not_api" && offer.appliesTo === "api_inference";
}

export function partitionOffers(offers: ProviderOffer[], now: Date): {
  active: ProviderOffer[];
  expired: ProviderOffer[];
  expiring: ProviderOffer[];
  moved: ProviderOffer[];
} {
  const active: ProviderOffer[] = [];
  const expired: ProviderOffer[] = [];
  const expiring: ProviderOffer[] = [];
  const moved: ProviderOffer[] = [];
  const week = 7 * 86_400_000;
  for (const offer of offers) {
    const expiry = offer.expiresAt ? Date.parse(offer.expiresAt) : Number.NaN;
    const past = Number.isFinite(expiry) && expiry <= now.getTime();
    if (past && offer.status !== "expired") {
      const next = { ...offer, status: "expired" as const };
      expired.push(next);
      moved.push(next);
      continue;
    }
    if (offer.status === "expired" || past) {
      expired.push(offer.status === "expired" ? offer : { ...offer, status: "expired" });
      continue;
    }
    active.push(offer);
    if (Number.isFinite(expiry) && expiry - now.getTime() <= week) expiring.push(offer);
  }
  return { active, expired, expiring, moved };
}

export function hostAllowed(website: string, targetUrl: string): boolean {
  let site: URL;
  let target: URL;
  try {
    site = new URL(website);
    target = new URL(targetUrl);
  } catch {
    return false;
  }
  if (target.protocol !== "https:") return false;
  if (target.username || target.password) return false;
  const apex = (host: string) => {
    const parts = host.toLowerCase().split(".").filter(Boolean);
    return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
  };
  return apex(site.hostname) === apex(target.hostname) && apex(site.hostname).includes(".");
}

type RobotGroup = { agents: string[]; disallow: string[] };

export function robotsDisallows(body: string, path: string, agent = "video-agent-provider-intel/1.0"): boolean {
  const groups: RobotGroup[] = [];
  let current: RobotGroup | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.split("#")[0]?.trim() ?? "";
    if (!line) {
      current = null;
      continue;
    }
    const split = line.indexOf(":");
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase();
    const value = line.slice(split + 1).trim();
    if (key === "user-agent") {
      if (!current || current.disallow.length) {
        current = { agents: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (key === "disallow" && current && value) current.disallow.push(value);
  }
  const needle = agent.toLowerCase();
  const specific = groups.find((group) => group.agents.some((item) => item !== "*" && (needle.includes(item) || item.includes("video-agent-provider-intel"))));
  const star = groups.find((group) => group.agents.includes("*"));
  const rules = (specific ?? star)?.disallow ?? [];
  return rules.some((rule) => rule === "/" || path.startsWith(rule));
}

export function connectionProbeAllowed(auth: { authType?: string | null; type?: string | null }): boolean {
  const raw = `${auth.authType ?? ""} ${auth.type ?? ""}`.trim().toLowerCase();
  if (!raw || raw === "unknown") return false;
  if (/cookie|session|browser|web/.test(raw)) return false;
  return /api[_-]?key|apikey|token|bearer|key/.test(raw);
}

export function connectionStates(input: {
  configured: boolean;
  credentialPresent: boolean;
  testOk: boolean;
  modelsDiscovered: boolean;
  probeOk: boolean;
  rateLimited: boolean;
  quotaExhausted: boolean;
  expired: boolean;
  invalidCredentials: boolean;
}): AccountStatus[] {
  const states: AccountStatus[] = [];
  if (input.configured) states.push("CONFIGURED");
  if (input.credentialPresent) states.push("AUTHENTICATED");
  if (input.testOk) states.push("CONNECTED");
  if (input.modelsDiscovered) states.push("MODEL_DISCOVERED");
  if (input.probeOk) states.push("CALLABLE");
  if (input.rateLimited) states.push("RATE_LIMITED");
  if (input.quotaExhausted) states.push("QUOTA_EXHAUSTED");
  if (input.expired) states.push("EXPIRED");
  if (input.invalidCredentials) states.push("INVALID_CREDENTIALS");
  if (!states.length) states.push("UNKNOWN");
  return states;
}

export function probeAllowedToday(lastProbeAt: string | null, now: Date, timeZone = "Asia/Ho_Chi_Minh"): boolean {
  if (!lastProbeAt) return true;
  const fmt = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  const previous = new Date(lastProbeAt);
  if (Number.isNaN(previous.getTime())) return true;
  return fmt(previous) !== fmt(now);
}

function stub(
  id: string,
  name: string,
  website: string,
  categories: ProviderCategory[],
  discoveredFrom: string,
): ProviderStub {
  return ProviderStubSchema.parse({ id, name, website, categories, needsResearch: true, discoveredFrom });
}

export const PROVIDER_STUBS: ProviderStub[] = [
  stub("github-copilot", "GitHub Copilot", "https://github.com", ["llm"], "omniroute-likely"),
  stub("antigravity", "Antigravity", "https://ai.google.dev", ["llm"], "omniroute-likely"),
  stub("claude", "Claude", "https://www.anthropic.com", ["llm"], "omniroute-likely"),
  stub("codex", "Codex", "https://openai.com", ["llm"], "omniroute-likely"),
  stub("gemini", "Gemini", "https://ai.google.dev", ["llm"], "omniroute-likely"),
  stub("openrouter", "OpenRouter", "https://openrouter.ai", ["aggregator", "llm"], "omniroute-likely"),
  stub("groq", "Groq", "https://groq.com", ["llm"], "omniroute-likely"),
  stub("cerebras", "Cerebras", "https://www.cerebras.ai", ["llm"], "omniroute-likely"),
  stub("mistral", "Mistral", "https://mistral.ai", ["llm"], "omniroute-likely"),
  stub("cohere", "Cohere", "https://cohere.com", ["llm", "embedding", "rerank"], "omniroute-likely"),
  stub("cloudflare-workers-ai", "Cloudflare Workers AI", "https://developers.cloudflare.com", ["llm"], "omniroute-likely"),
  stub("sambanova", "SambaNova", "https://sambanova.ai", ["llm"], "omniroute-likely"),
  stub("together", "Together", "https://www.together.ai", ["llm"], "omniroute-likely"),
  stub("huggingface", "Hugging Face", "https://huggingface.co", ["llm", "aggregator"], "omniroute-likely"),
  stub("byteplus-modelark", "BytePlus ModelArk", "https://www.byteplus.com", ["llm"], "prior-list"),
  stub("volcengine-ark", "Volcengine Ark", "https://www.volcengine.com", ["llm"], "prior-list"),
  stub("longcat", "LongCat", "https://longcat.chat", ["llm"], "prior-list"),
  stub("deepseek", "DeepSeek", "https://www.deepseek.com", ["llm"], "prior-list"),
  stub("ai21", "AI21", "https://www.ai21.com", ["llm"], "prior-list"),
  stub("hyperbolic", "Hyperbolic", "https://hyperbolic.xyz", ["gpu", "llm"], "prior-list"),
  stub("nscale", "Nscale", "https://www.nscale.com", ["gpu", "cloud"], "prior-list"),
  stub("deepinfra", "DeepInfra", "https://deepinfra.com", ["llm"], "prior-list"),
  stub("fireworks", "Fireworks AI", "https://fireworks.ai", ["llm"], "prior-list"),
  stub("nebius", "Nebius", "https://nebius.com", ["gpu", "cloud"], "prior-list"),
  stub("scaleway", "Scaleway", "https://www.scaleway.com", ["cloud", "gpu", "llm"], "prior-list"),
  stub("novita", "Novita AI", "https://novita.ai", ["llm", "image"], "prior-list"),
  stub("replicate", "Replicate", "https://replicate.com", ["aggregator", "image"], "seed-extra"),
  stub("fal", "Fal", "https://fal.ai", ["image", "video"], "seed-extra"),
  stub("elevenlabs", "ElevenLabs", "https://elevenlabs.io", ["tts"], "seed-extra"),
  stub("stability", "Stability AI", "https://stability.ai", ["image"], "seed-extra"),
  stub("runway", "Runway", "https://runwayml.com", ["video"], "seed-extra"),
  stub("modal", "Modal", "https://modal.com", ["gpu"], "seed-extra"),
  stub("lambda", "Lambda", "https://lambdalabs.com", ["gpu", "cloud"], "seed-extra"),
  stub("xai", "xAI", "https://x.ai", ["llm"], "seed-extra"),
];

export const DEFAULT_DISCOVERY_FEEDS = [
  { url: "https://status.openai.com/history.rss", label: "OpenAI status" },
  { url: "https://www.anthropic.com/news", label: "Anthropic news" },
  { url: "https://groq.com/blog", label: "Groq blog" },
];

export function providerSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Names and official links found in a curated feed. Hosts already known are skipped. */
export function discoverCandidates(
  text: string,
  knownHosts: Set<string>,
): Array<{ id: string; name: string; website: string; categories: ProviderCategory[] }> {
  const chunks = text.match(/<item\b[\s\S]*?<\/item>/gi) ?? [text];
  const found: Array<{ id: string; name: string; website: string; categories: ProviderCategory[] }> = [];
  for (const chunk of chunks) {
    const title = chunk.match(/<title>([^<]{2,80})<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
    const link = chunk.match(/<link>([^<]+)<\/link>/i)?.[1]?.trim()
      ?? chunk.match(/href="(https?:\/\/[^"]+)"/i)?.[1];
    if (!title || !link) continue;
    let website: URL;
    try {
      website = new URL(link);
    } catch {
      continue;
    }
    if (knownHosts.has(website.host)) continue;
    const id = providerSlug(title);
    if (id.length < 3) continue;
    knownHosts.add(website.host);
    found.push({ id, name: title, website: website.origin, categories: ["llm"] });
    if (found.length >= 8) break;
  }
  return found;
}

export type OverviewFacts = {
  registered: number;
  callable: number;
  freeQuota: number;
  unusedBenefits: number;
  cloudExtras: number;
  vietnamOk: number;
  cardOrKyc: number;
  expiringSoon: number;
  usefulForProjects: number;
  safeToActivate: number;
};

export function overviewQuestions(facts: OverviewFacts): Array<{ id: string; questionVi: string; answerVi: string }> {
  return [
    { id: "registered", questionVi: "Nhà cung cấp nào đã có trong danh mục?", answerVi: `${facts.registered} nhà cung cấp đã được ghi.` },
    { id: "callable", questionVi: "Nhà cung cấp nào gọi được?", answerVi: `${facts.callable} kết nối đang ở trạng thái gọi được.` },
    { id: "free", questionVi: "Nhà cung cấp nào còn quota miễn phí?", answerVi: `${facts.freeQuota} ưu đãi API đang còn hiệu lực.` },
    { id: "unused", questionVi: "Lợi ích nào chưa dùng?", answerVi: `${facts.unusedBenefits} lợi ích chưa kích hoạt.` },
    { id: "cloud", questionVi: "Có thêm dịch vụ đám mây nào?", answerVi: `${facts.cloudExtras} dòng dịch vụ đám mây được ghi.` },
    { id: "vietnam", questionVi: "Cá nhân ở Việt Nam dùng được gì?", answerVi: `${facts.vietnamOk} nhà cung cấp có bằng chứng cá nhân ở Việt Nam đăng ký được.` },
    { id: "card", questionVi: "Cái gì cần thẻ hoặc KYC?", answerVi: `${facts.cardOrKyc} mục cần thẻ hoặc KYC.` },
    { id: "expiring", questionVi: "Cái gì sắp hết hạn?", answerVi: `${facts.expiringSoon} ưu đãi hết hạn trong 7 ngày.` },
    { id: "useful", questionVi: "Cái gì hữu ích cho dự án?", answerVi: `${facts.usefulForProjects} model đang nằm trong đề xuất định tuyến.` },
    { id: "safe", questionVi: "Cái gì an toàn để bật mà không phát sinh chi?", answerVi: `${facts.safeToActivate} mục rủi ro thanh toán thấp và không cần thẻ.` },
  ];
}
