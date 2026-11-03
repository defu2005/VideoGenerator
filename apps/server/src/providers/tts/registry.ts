import type { AppConfig } from "../../lib/config.js";
import { EdgeTtsProvider } from "./edgeTts.js";
import { MockTtsProvider } from "./mockTts.js";
import type { TtsProvider, TtsVoice } from "./types.js";

export class TtsProviderRegistry {
  private readonly providers = new Map<string, TtsProvider>();

  constructor(private readonly config: AppConfig) {
    const edge = new EdgeTtsProvider(config.EDGE_TTS_PATH ?? null, config.TTS_TIMEOUT_MS);
    this.providers.set(edge.id, edge);
    this.providers.set("mock", new MockTtsProvider());
  }

  get(id: string): TtsProvider | undefined {
    return this.providers.get(id) ?? this.providers.get(this.config.TTS_PROVIDER);
  }

  resolve(): TtsProvider {
    return this.get(this.config.TTS_PROVIDER) ?? this.providers.get("mock")!;
  }

  async listVoices(providerId?: string): Promise<TtsVoice[]> {
    const provider = providerId ? this.get(providerId) : this.resolve();
    return provider ? provider.listVoices() : [];
  }
}
