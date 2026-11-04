/** Appends a guideline block as its own section. Empty guidance leaves the prompt unchanged. */
export function appendGuidelineGuidance(prompt: string, guidance?: string): string {
  const text = guidance?.trim();
  return text ? `${prompt}\n\n${text}` : prompt;
}
