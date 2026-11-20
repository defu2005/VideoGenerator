import { datedEvents, fitGraphicPayload, processLanguage, type ShotSource } from "@vg/shared";
import { directivesOf, type DirectorInput } from "../director.js";

export function timelinePiece(input: DirectorInput): { kind: "timeline"; start: number; end: number; reason: string; payload: ShotSource } | null {
  if (directivesOf(input).disabledKinds.includes("timeline")) return null;
  const events = datedEvents(input.words);
  if (events.length < 3) return null;
  const start = events[0]!.wordStart, end = events.at(-1)!.wordEnd;
  const payload = fitGraphicPayload("timeline", { events: events.map(({ date, label }) => ({ date, label })) });
  return payload ? { kind: "timeline", start, end, payload, reason: "R11-timeline" } : null;
}

/** A model may only extract the structure, not invent node labels, event dates, captions or remote images. */
export function structuredPayloadIsSpoken(input: DirectorInput, source: ShotSource): boolean {
  const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const spoken = ` ${fold(input.words.map((word) => word.text).join(" "))} `;
  const own = (label: string) => spoken.includes(` ${fold(label)} `);
  if (source.kind === "diagram") return (!source.title || own(source.title)) && processLanguage(input.scene.text) && source.nodes.every((node) => own(node.label)) && source.edges.every((edge) => !edge.label || own(edge.label));
  if (source.kind === "timeline") {
    const events = datedEvents(input.words);
    return (!source.title || own(source.title)) && events.length >= 3 && source.events.every((event) => events.some((spoken) => spoken.date === event.date
      && ` ${fold(input.words.slice(spoken.wordStart, spoken.wordEnd).map((word) => word.text).join(" "))} `.includes(` ${fold(event.label)} `)) && !event.imagePath);
  }
  return true;
}

/** A readable list from speech remains available when a requested structure fails validation. */
export function structuredListFallback(input: DirectorInput, start: number, end: number): ShotSource | null {
  const spoken = input.words.slice(start, end).map((word) => word.text.replace(/^[,;:.!?…]+|[,;:.!?…]+$/gu, "")).filter(Boolean);
  if (spoken.length < 3) return null;
  const size = Math.ceil(spoken.length / 3);
  const items = Array.from({ length: 3 }, (_, index) => {
    const words = spoken.slice(index * size, (index + 1) * size);
    let label = "";
    for (const word of words) { if ((label ? `${label} ${word}` : word).length > 36) break; label = label ? `${label} ${word}` : word; }
    return label;
  });
  return fitGraphicPayload("list_full", { items, marker: "dot", highlight: "none" });
}
