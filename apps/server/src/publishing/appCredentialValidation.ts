import { validatePlatformAppInput } from "@vg/shared";
import { AppError } from "../lib/errors.js";

export function requireValidPlatformApp(platform: string, credentials: { clientId: string; clientSecret: string }): void {
  const { ok, errors } = validatePlatformAppInput(platform, credentials);
  if (!ok) throw new AppError(400, "INVALID_APP_CREDENTIALS", Object.values(errors).join(" "), errors);
}
