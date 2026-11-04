# TASK-017 — Content guidelines: platform policy and channel direction packs

User request (2026-11-04): add options that remind and filter the LLM, covering:
- platform policies (YouTube, TikTok, Facebook);
- channel direction (drama, storytelling, …).

Quality comes before token savings: an LLM check pass is on from BALANCED up.

## 1. Model (`packages/shared/src/guidelines`)

```ts
GuidelineRule = {
  id: string;                       // stable, e.g. "yt.real-people.unverified-claims"
  text: string;                     // reminder sentence that goes into prompts
  severity: "MUST" | "SHOULD" | "TIP";
  appliesTo: ("script" | "visuals" | "music" | "subtitles" | "metadata")[];
  check?: CodeCheckId;              // optional deterministic check (see §3)
};
GuidelinePack = {
  id: string; kind: "PLATFORM" | "CHANNEL" | "CUSTOM";
  name: string; description: string;
  reviewedAt: string;               // ISO date the text was last reviewed
  sourceUrls: string[];             // official policy pages to verify against
  params?: { maxDurationSec?: number; hookWithinSec?: number; aspectRatios?: AspectRatio[] };
  rules: GuidelineRule[];
};
```

The project setting is `guidelines`:

```ts
{
  platformPack: "auto" | string | null;  // "auto" follows settings.platform
  channelPacks: string[];                // 0..3 packs, e.g. ["drama"]
  customRules: string[];                 // free text, each becomes a SHOULD rule
  strictness: "REMIND" | "FILTER";       // default FILTER from BALANCED up, REMIND in ECO
}
```

The app keeps a **channel profile**: a saved set of channel packs, custom rules and a default platform. It is applied when a project is created, so a channel's rules are not retyped for every video.

## 2. Built-in packs (editable copies)

The built-ins ship in shared. The user can duplicate and edit them in Settings → "Định hướng nội dung". Edited copies are stored in app settings, and the built-ins never change at runtime.

Every pack shows:
- its `reviewedAt` date;
- the line "Đây là nhắc nhở tóm tắt, không thay thế chính sách chính thức".

### Platform packs
- **youtube, youtube_shorts:** the YouTube Community Guidelines and monetization basics:
  - claims about real people must be sourced, and rumor is never stated as fact (defamation);
  - no harassment;
  - no misleading title, thumbnail or metadata;
  - realistic AI-generated or altered content must be disclosed;
  - music and footage copyright;
  - kids audience means "made for kids" limits;
  - graphic violence and dangerous acts are restricted;
  - medical and election misinformation;
  - Shorts length and aspect-ratio params.
- **tiktok:** the TikTok Community Guidelines:
  - AI-generated content label;
  - dangerous challenges;
  - minor safety;
  - misinformation;
  - commercial music limits;
  - a hook in the first seconds;
  - vertical 9:16.
- **facebook_reels:** the Meta Community Standards:
  - AI info label;
  - bullying of public figures;
  - misinformation;
  - original-content preference;
  - music rights.

`sourceUrls`, to be verified when implementing:
- https://www.youtube.com/howyoutubeworks/policies/community-guidelines/
- https://www.tiktok.com/community-guidelines
- https://transparency.meta.com/policies/community-standards/

### Channel packs
- **drama:**
  - hook within 3–5 s;
  - conflict early;
  - escalation;
  - a cliffhanger or twist before the end;
  - emotional beats;
  - never invent facts about real people to raise the drama.
- **storytelling:**
  - a clear protagonist and goal;
  - three acts;
  - sensory detail;
  - callbacks;
  - an ending that pays off the hook.
- **documentary, explainer, news, listicle, kids, mystery:** same shape, with pacing and tone rules.

**Mapping:** `settings.style` and `settings.tone` suggest packs, for example tone "dramatic" suggests drama. The user confirms or edits the suggestion, and quick create pre-fills it.

## 3. Where the rules apply

- **REMIND, every mode.** Matching rules (by `appliesTo`) are injected into these prompts:
  - research, script, scriptReview;
  - sceneQueries, visualAltQueries;
  - musicAssist, metadata;
  - the review chat (TASK-018).

  This costs about 300–800 extra input tokens per call and needs no extra call.
- **FILTER**, on top of REMIND:
  - **Code checks**, 0 LLM calls, after SCRIPT and after TIMELINE:
    - duration over `maxDurationSec`;
    - aspect ratio not in the pack;
    - first narration too long to hook within `hookWithinSec`;
    - custom blocked words;
    - license warnings carried over from the timeline.
  - **The LLM task `guidelineCheck`** (new LlmTaskId, tier strong, budget feature `guidelineCheck`):
    - one call after the script review;
    - input: the script per scene, the active rules and the brief;
    - output, zod-validated: `findings[] {ruleId, severity, sceneId|null, quote, problem, suggestion}`;
    - cached by hash of (script, rules, model).
  - **QUALITY and MAX:** when there are MUST findings, one extra scriptReview pass gets the findings as instructions to fix, then `guidelineCheck` runs once more. That is at most 2 extra calls.
- **Findings:**
  - are stored in the `guideline_findings` table (project, stage, ruleId, severity, sceneId, text, status OPEN / FIXED / DISMISSED, dismissedBy);
  - are shown in the Script tab and the Timeline panel.
- **MUST findings:**
  - mark the scene `NEEDS_ATTENTION`;
  - stop AUTO mode at the next gate, so it never auto-approves past them.
  - Never a hard block: the user can dismiss a finding with an optional reason. This is the same principle as licenses.

## 4. Budget

| Mode | guidelineCheck | Fix pass |
|---|---|---|
| ECO | off (REMIND only) | – |
| BALANCED | 1 call | – |
| QUALITY / MAX | 1 call | up to +1 review and +1 check |

CUSTOM: toggle `guidelineCheck` per feature. The estimate UI includes these calls.

## 5. API and UI
- `GET/PUT /api/guidelines/packs`: the built-ins plus the user's copies.
- `GET/PUT /api/guidelines/profiles`.
- Project settings `guidelines` in create/edit, with a pack picker that shows the rule list.
- `GET /api/projects/:id/guidelines/findings` and `POST …/findings/:id/dismiss`.
- `POST /api/projects/:id/guidelines/check` runs code checks plus `guidelineCheck` on demand.
- The MCP tool `get_guidelines` gives Claude Desktop / Copilot Chat the same reminders (a 0-token path).

## 6. Tests
- Pack schemas.
- Prompt injection: which rules reach which task.
- Code checks.
- `guidelineCheck` with the mock provider: findings are parsed, cached, and a MUST finding leads to NEEDS_ATTENTION and stops AUTO at the gate.
- Dismissing a finding.
- Web: pack picker, findings list.
- No network in tests.
