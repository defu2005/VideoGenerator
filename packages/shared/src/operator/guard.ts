/** The user's real project. Every tool surface must refuse it. */
export const PROTECTED_PROJECT_ID = "56374fb2-54cf-48ff-9441-2e6c653295d4";

export function containsProtectedProject(value: unknown): boolean {
  if (typeof value === "string") return value.includes(PROTECTED_PROJECT_ID);
  if (Array.isArray(value)) return value.some((item) => containsProtectedProject(item));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => containsProtectedProject(item));
  }
  return false;
}
