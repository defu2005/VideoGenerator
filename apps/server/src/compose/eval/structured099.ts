import type { ShotSource } from "@vg/shared";

/** Offline TASK-099 acceptance fixtures, alongside the existing compose equivalence matrix. */
export const STRUCTURED_099_FIXTURES: Array<{ id: string; genre: string; text: string; source: ShotSource }> = [
  {
    id: "water-process", genre: "explainer",
    text: "Nước gặp nhiệt tạo thành hơi nước rồi hơi nước ngưng tụ thành mây. Đây là quy trình trong tự nhiên.",
    source: { kind: "diagram", layout: "flow", nodes: [{ id: "a", label: "Nước" }, { id: "b", label: "hơi nước" }, { id: "c", label: "mây" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] },
  },
  {
    id: "space-history", genre: "history",
    text: "Năm 1961 bay vào vũ trụ. Năm 1969 đặt chân lên Mặt Trăng. Năm 1971 có trạm không gian.",
    source: { kind: "timeline", events: [{ date: "1961", label: "bay vào vũ trụ" }, { date: "1969", label: "đặt chân lên Mặt Trăng" }, { date: "1971", label: "có trạm không gian" }] },
  },
];
