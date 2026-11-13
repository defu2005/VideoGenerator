import type { KnowledgeKind } from "./schema.js";

type Reaction = "R0" | "R1" | "R2" | "R3" | "R4" | "R5";
export type ChangeCategory = {
  id: string; name: string; example: string; kinds: readonly KnowledgeKind[];
  detectors: readonly string[]; manual: string;
  reactions: { low: Reaction; medium: Reaction; high: Reaction };
};

/** D1–D7 denote planned integration points. Manual review covers 073a. */
export const CHANGE_CATEGORIES: readonly ChangeCategory[] = [
  {
    "id": "A1",
    "name": "Content and community policy",
    "example": "new banned topics, stricter rules for violence, misinformation or elections",
    "kinds": [
      "guideline_pack",
      "law"
    ],
    "detectors": [
      "D1",
      "D3",
      "D7"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "A2",
    "name": "Monetization programs",
    "example": "eligibility, revenue share, programs that merge, close or open, country lists",
    "kinds": [
      "monetization_program"
    ],
    "detectors": [
      "D1",
      "D3",
      "D7"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "A3",
    "name": "Originality, AI and automation policy",
    "example": "reused/inauthentic content, AI labels, mass-produced content",
    "kinds": [
      "guideline_pack",
      "creator_tactic"
    ],
    "detectors": [
      "D1",
      "D3",
      "D4"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "A4",
    "name": "Ad suitability and brand safety",
    "example": "advertiser-friendly rules, limited-ads triggers",
    "kinds": [
      "guideline_pack"
    ],
    "detectors": [
      "D1",
      "D3"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "A5",
    "name": "Rights and licensing",
    "example": "Content ID, music rules, stock licence terms, attribution",
    "kinds": [
      "guideline_pack",
      "provider_terms"
    ],
    "detectors": [
      "D1",
      "D2",
      "D3"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "A6",
    "name": "Audience-specific rules",
    "example": "made-for-kids, age limits, minors in videos",
    "kinds": [
      "guideline_pack",
      "law"
    ],
    "detectors": [
      "D1",
      "D7"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "B1",
    "name": "Format and metadata specs",
    "example": "max length, aspect ratio, file size, title/description/tag/hashtag limits, caption formats",
    "kinds": [
      "platform_capability"
    ],
    "detectors": [
      "D1",
      "D2"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "B2",
    "name": "Platform APIs",
    "example": "deprecated endpoints, new scopes, quota costs, rate limits, app audits, token lifetime",
    "kinds": [
      "platform_capability",
      "api_contract"
    ],
    "detectors": [
      "D1",
      "D2"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "B3",
    "name": "Platform features",
    "example": "features added or removed (A/B tests, multi-language audio, Shorts linking, chapters); API vs UI-only",
    "kinds": [
      "platform_capability"
    ],
    "detectors": [
      "D1",
      "D2"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "B4",
    "name": "Ranking and recommendation",
    "example": "what the algorithm rewards shifts; rarely announced",
    "kinds": [
      "creator_tactic"
    ],
    "detectors": [
      "D4",
      "D5",
      "exploration"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "B5",
    "name": "Platform availability and rise/decline",
    "example": "country bans, a platform shrinking, a new platform worth adding",
    "kinds": [
      "market",
      "platform_capability"
    ],
    "detectors": [
      "D1",
      "D5",
      "D7"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "C1",
    "name": "Audience behaviour",
    "example": "best posting hours, preferred length, language mix",
    "kinds": [
      "market"
    ],
    "detectors": [
      "D4",
      "exploration"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "C2",
    "name": "Topics, formats, niches",
    "example": "trends rise and fade, saturation, competition",
    "kinds": [],
    "detectors": [
      "D5",
      "D4",
      "exploration"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "C3",
    "name": "Calendar and news",
    "example": "seasonal events, breaking news, election periods",
    "kinds": [
      "market"
    ],
    "detectors": [
      "D5",
      "D1"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "C4",
    "name": "Ad market and money",
    "example": "RPM/CPM, currency, sponsor rates",
    "kinds": [
      "market",
      "monetization_program"
    ],
    "detectors": [
      "D3",
      "D1",
      "D6"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "C5",
    "name": "Local law",
    "example": "AI labelling laws, ad-disclosure law, privacy and data law, age-verification law",
    "kinds": [
      "market",
      "law"
    ],
    "detectors": [
      "D1",
      "D6",
      "D7"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "D1",
    "name": "LLM providers",
    "example": "model retired, price, quota, quality drift, terms",
    "kinds": [
      "provider_terms"
    ],
    "detectors": [
      "D2",
      "provider_intel"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "D2",
    "name": "TTS, footage, image and music sources",
    "example": "voices removed, keys paused (as Pexels did), licence or caching terms",
    "kinds": [
      "provider_terms"
    ],
    "detectors": [
      "D1",
      "D2",
      "D6"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "D3",
    "name": "Tools and dependencies",
    "example": "CLI discontinued (as Gemini CLI was), renderer or ffmpeg changes, npm deprecations and advisories",
    "kinds": [
      "dependency"
    ],
    "detectors": [
      "D2",
      "D6",
      "D7"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "E1",
    "name": "Account health",
    "example": "strikes, warnings, suspension, revoked tokens, lost verification",
    "kinds": [
      "account_policy"
    ],
    "detectors": [
      "D3",
      "D2"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "E2",
    "name": "Video health",
    "example": "removed, age-restricted, limited ads, claimed, blocked in some countries",
    "kinds": [],
    "detectors": [
      "D3"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "E3",
    "name": "Channel milestones",
    "example": "crossing a threshold makes a program possible",
    "kinds": [
      "monetization_program"
    ],
    "detectors": [
      "D3"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "E4",
    "name": "Unexplained performance change",
    "example": "a sudden drop or rise with no known cause",
    "kinds": [],
    "detectors": [
      "D4"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R5",
      "high": "R5"
    }
  },
  {
    "id": "F1",
    "name": "Our cost and budget",
    "example": "price changes that change the profit per video",
    "kinds": [
      "provider_terms"
    ],
    "detectors": [
      "D2",
      "provider_intel"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "F2",
    "name": "The user's goals",
    "example": "new market, new niche, budget changes",
    "kinds": [],
    "detectors": [
      "D7",
      "settings"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "G1",
    "name": "Knowledge quality",
    "example": "sources disagree, a source page 404s, a fact proven wrong by our own data",
    "kinds": [],
    "detectors": [
      "D1",
      "D4",
      "D6"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R2"
    }
  },
  {
    "id": "B6",
    "name": "Data meaning changes, schema stays",
    "example": "YouTube mostPopular became Music/Movies/Gaming on 2025-07-21; Shorts views counted differently from 2025-03-31",
    "kinds": [
      "api_contract"
    ],
    "detectors": [
      "D1",
      "D2"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R1"
    }
  },
  {
    "id": "B7",
    "name": "Alias or upstream changes while requests still work",
    "example": "DeepSeek routed old deepseek-v4-flash IDs to V4.1 Flash on 2026-09-10",
    "kinds": [
      "api_contract",
      "provider_terms"
    ],
    "detectors": [
      "D1",
      "D4",
      "provider_intel"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R2",
      "high": "R2"
    }
  },
  {
    "id": "B8",
    "name": "Quota units or buckets change",
    "example": "YouTube gave videos.insert and search.list their own buckets on 2026-06-01",
    "kinds": [
      "api_contract"
    ],
    "detectors": [
      "D1",
      "D2"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R4",
      "high": "R4"
    }
  },
  {
    "id": "D4",
    "name": "New sign-ups or one account group lose access",
    "example": "Pexels paused new API keys (2026-11); Gemini CLI dropped personal Google login on 2026-06-18",
    "kinds": [
      "api_contract",
      "provider_terms",
      "dependency"
    ],
    "detectors": [
      "D1",
      "D7"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R1",
      "high": "R1"
    }
  },
  {
    "id": "E5",
    "name": "Consent or scope migration",
    "example": "TikTok User Info scope migration deadline 2024-02-29",
    "kinds": [
      "api_contract",
      "account_policy"
    ],
    "detectors": [
      "D1",
      "D2",
      "D7"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R2",
      "high": "R2"
    }
  },
  {
    "id": "G2",
    "name": "A source changes how it is reached, data still exists",
    "example": "Wikimedia API Portal closed 2026-06 while the wiki endpoints stayed",
    "kinds": [
      "api_contract"
    ],
    "detectors": [
      "D1",
      "D6"
    ],
    "manual": "Người dùng đối chiếu nguồn hoặc trạng thái trong lúc chưa có detector tương ứng.",
    "reactions": {
      "low": "R0",
      "medium": "R2",
      "high": "R2"
    }
  }
];
