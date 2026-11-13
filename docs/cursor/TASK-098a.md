# TASK-098a — Channel identity + host persona 🎙️

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-medium`). Fable writes 2–3 identity and persona sample sets (a separate brief). **Size:** M. **Migration:** yes (`profiles.identity`, `profiles.persona`); drizzle-kit only (🗄). **New dependency:** none.
**Depends on:** TASK-094. The style pack (TASK-111) covers the visual identity; this task covers the **voice and character**.

## Why

Channels that feel like "someone" keep viewers and are less likely to be judged mass-produced. Today each script starts from zero: there is no consistent host voice, catchphrases or memory of what was said before.

## Read first

- `docs/ARCHITECTURE-TARGET.md` §3 `profiles` extension.
- The profile page and its tabs, the script prompt builder, and the TTS voice settings per profile (TASK-040).
- The style pack (111). Identity links to it; it does not duplicate colours or fonts.

## Build

1. **Schemas** in `packages/shared`:
   - `identity`: mission line, audience, tone words, banned phrases, intro and outro format, CTA style, and the style pack id;
   - `persona`: name (optional), point of view (first person or narrator), speech traits, catchphrases (max 3, with a use limit), humour level and the TTS voice.
2. **Prompt use.** The script and packaging prompts get the identity and persona. A code check counts the catchphrase use against the limit, and banned phrases cause a script fix pass.
3. **Said-before memory.**
   - After publish, index the script's key claims and jokes per channel in the retrieval index, with scope "đã nói".
   - The script prompt gets "đừng lặp lại" items for the topic. Originality (084) can use it too.
4. **Web.** A "Nhận diện" tab: identity + persona forms, the Fable sample sets as starting points, and a preview where the LLM writes a 2-sentence intro in the persona (ECO: no preview).
5. **Tools:** `get_identity`: read; `set_identity`: confirm, grant `null`.

## Mã nguồn mở có sẵn (open source)

- Nothing to adopt. Character-card formats such as **SillyTavern** cards (AGPL — read only) are a reference for persona fields.

## Rules

README rules 1–11. A persona never claims to be a real person or a human if the channel uses AI voice; the AI label rule (083) wins.

## Tests

- the schemas;
- prompt contains identity and persona;
- the catchphrase limit;
- a banned phrase triggers the fix pass;
- said-before indexing and retrieval;
- tool risk.

## Done

- [ ] schemas + migration + prompt use + memory
- [ ] tab + tools + skill (`video-ho-so-kenh`)
- [ ] tests; suites
- [ ] user guide + changelog
- [ ] report → `docs/tasks/TASK-098a.done`
