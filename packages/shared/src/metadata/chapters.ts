export type ChapterScene = {
  startSec: number;
  endSec: number;
  label: string;
};

export type ChapterSection = {
  id?: string;
  heading: string;
};

export type ChapterLine = {
  startSec: number;
  label: string;
  text: string;
};

/**
 * YouTube-style chapter lines from timeline scene starts.
 * Only when the video is ≥ 60 s and there are ≥ 3 script sections.
 * First chapter is always 00:00; merge chapters shorter than 10 s.
 */
export function buildChapters(
  timeline: { totalDurationSec: number; scenes: readonly ChapterScene[] },
  sections: readonly ChapterSection[],
): ChapterLine[] {
  if (timeline.totalDurationSec < 60 || sections.length < 3 || timeline.scenes.length === 0) {
    return [];
  }

  let chapters = timeline.scenes.map((scene, index) => {
    const heading = sections[Math.min(index, sections.length - 1)]?.heading;
    return {
      startSec: Math.max(0, scene.startSec),
      label: (scene.label || heading || `Scene ${index + 1}`).trim() || `Scene ${index + 1}`,
    };
  });
  chapters[0] = { ...chapters[0], startSec: 0 };

  // Merge any chapter whose span to the next start (or video end) is under 10 s.
  let changed = true;
  while (changed && chapters.length > 1) {
    changed = false;
    for (let index = 0; index < chapters.length; index += 1) {
      const end = index + 1 < chapters.length
        ? chapters[index + 1].startSec
        : timeline.totalDurationSec;
      if (end - chapters[index].startSec >= 10) continue;
      if (index === 0) {
        chapters = [{ ...chapters[1], startSec: 0 }, ...chapters.slice(2)];
      } else {
        chapters = chapters.filter((_, itemIndex) => itemIndex !== index);
      }
      changed = true;
      break;
    }
  }

  if (chapters.length < 3) return [];

  return chapters.map((item) => ({
    startSec: item.startSec,
    label: item.label,
    text: `${formatChapterTime(item.startSec)} ${item.label}`,
  }));
}

export function formatChapterTime(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function chaptersText(chapters: readonly ChapterLine[]): string {
  return chapters.map((chapter) => chapter.text).join("\n");
}
