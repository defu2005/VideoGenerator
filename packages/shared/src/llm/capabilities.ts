export type CapabilitySource = "override" | "omniroute" | "litellm" | "name" | "probe";

export type ModelCapability = {
  modelId: string;
  vision?: boolean;
  tools?: boolean;
  json?: boolean;
  jsonMode?: boolean;
  contextTokens?: number;
  source: CapabilitySource;
  sources: Partial<Record<"vision" | "tools" | "jsonMode" | "contextTokens", CapabilitySource>>;
};

export type CapabilityOverride = {
  vision?: boolean;
  tools?: boolean;
  json?: boolean;
  jsonMode?: boolean;
  contextTokens?: number;
};

const NAME_VISION = /(?:^|\/)(?:gpt-4o|gemini-|claude-3|grok-4|grok-imagine|llava|pixtral)/i;

/** Trimmed MIT snapshot from LiteLLM model_prices_and_context_window.json, copied 2026-11-10. */
export const LITELLM_CAPABILITIES: Record<string, CapabilityOverride> = {
  "gemini-2.5-flash": { vision: true, tools: true, json: true },
  "gpt-4o-mini": { vision: true, tools: true, json: true },
};

/** First defined value wins, separately for each field. */
export function resolveCapability(input: {
  modelId: string;
  override?: CapabilityOverride;
  omniroute?: CapabilityOverride;
  litellm?: CapabilityOverride;
  probe?: CapabilityOverride;
}): ModelCapability {
  const layers: Array<[CapabilitySource, CapabilityOverride | undefined]> = [
    ["override", input.override],
    ["omniroute", input.omniroute],
    ["litellm", input.litellm],
    ["probe", input.probe],
  ];
  const pick = (read: (layer: CapabilityOverride) => boolean | number | undefined, nameValue?: boolean | number) => {
    for (const [source, layer] of layers) {
      if (!layer) continue;
      const value = read(layer);
      if (value !== undefined) return { value, source };
    }
    return nameValue === undefined ? undefined : { value: nameValue, source: "name" as const };
  };
  const vision = pick((layer) => layer.vision, NAME_VISION.test(input.modelId) ? true : undefined);
  const tools = pick((layer) => layer.tools);
  const jsonMode = pick((layer) => layer.jsonMode ?? layer.json);
  const contextTokens = pick((layer) => layer.contextTokens);
  const sources: ModelCapability["sources"] = {};
  if (vision) sources.vision = vision.source;
  if (tools) sources.tools = tools.source;
  if (jsonMode) sources.jsonMode = jsonMode.source;
  if (contextTokens) sources.contextTokens = contextTokens.source;
  const source = vision?.source ?? tools?.source ?? jsonMode?.source ?? contextTokens?.source ?? "name";
  return {
    modelId: input.modelId,
    ...(vision ? { vision: vision.value === true } : {}),
    ...(tools ? { tools: tools.value === true } : {}),
    ...(jsonMode ? { json: jsonMode.value === true, jsonMode: jsonMode.value === true } : {}),
    ...(contextTokens ? { contextTokens: Number(contextTokens.value) } : {}),
    source,
    sources,
  };
}

/** A 1x1 PNG vision probe counts as vision only when the model answers "yes". */
export function probeSawImage(text: string): boolean {
  return /\byes\b/i.test(text) && !/\bno\b/i.test(text);
}
