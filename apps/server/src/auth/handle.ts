export type AuthHandle = {
  setupCode: () => string | null;
  verifyApiKey: (key: string) => Promise<{ valid: boolean; keyId?: string; userId?: string }>;
  revokeApiKey: (keyId: string) => Promise<void>;
};
