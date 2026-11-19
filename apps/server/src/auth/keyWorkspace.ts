export function apiKeyWorkspace(raw: unknown): string | undefined {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    return data && typeof data.workspaceId === "string" && data.workspaceId ? data.workspaceId : undefined;
  } catch { return undefined; }
}
