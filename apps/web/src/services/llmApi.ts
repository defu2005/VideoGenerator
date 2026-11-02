import { LlmProviderInfoSchema, type LlmProviderInfo } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getLlmProviders(): Promise<LlmProviderInfo[]> {
  return apiRequest<unknown>("/llm/providers").then((response) => {
    const parsed = LlmProviderInfoSchema.array().safeParse(response);
    if (!parsed.success) throw new Error("The server returned invalid LLM provider data");
    return parsed.data;
  });
}
