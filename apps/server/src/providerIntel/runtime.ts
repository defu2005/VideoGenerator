import { AppError } from "../lib/errors.js";
import type { ProviderIntelService } from "./service.js";

let current: ProviderIntelService | null = null;

export function setProviderIntel(service: ProviderIntelService | null): void {
  current = service;
}

export function providerIntel(): ProviderIntelService {
  if (!current) throw new AppError(503, "INTEL_UNAVAILABLE", "Nhà cung cấp AI chưa sẵn sàng.");
  return current;
}
