import { z } from "zod";
import { STOCK_IMAGE_PROVIDERS } from "./visual.js";

const StockProviderSchema = z.enum(STOCK_IMAGE_PROVIDERS);

/** The first image sources. Off by default (the user chose to use only the newer sources); can be turned back on in settings. */
export const LEGACY_IMAGE_PROVIDERS: readonly (typeof STOCK_IMAGE_PROVIDERS)[number][] = ["wikimedia", "openverse", "pexels"];

export const defaultImageSourcesEnabled = (): Record<(typeof STOCK_IMAGE_PROVIDERS)[number], boolean> =>
  Object.fromEntries(STOCK_IMAGE_PROVIDERS.map((id) => [id, !LEGACY_IMAGE_PROVIDERS.includes(id)])) as Record<
    (typeof STOCK_IMAGE_PROVIDERS)[number],
    boolean
  >;

export const ImageSourcesSettingsSchema = z.object({
  enabled: z.record(StockProviderSchema, z.boolean()),
}).strict();
export type ImageSourcesSettings = z.infer<typeof ImageSourcesSettingsSchema>;

export const ImageSourceStatusRowSchema = z.object({
  id: StockProviderSchema,
  label: z.string(),
  enabled: z.boolean(),
  keyRequired: z.boolean(),
  keyConfigured: z.boolean(),
  requestsPerMinute: z.number().int().positive(),
}).strict();
export type ImageSourceStatusRow = z.infer<typeof ImageSourceStatusRowSchema>;

export const ImageSourcesSettingsStatusSchema = z.object({
  enabled: z.record(StockProviderSchema, z.boolean()),
  sources: z.array(ImageSourceStatusRowSchema),
}).strict();
export type ImageSourcesSettingsStatus = z.infer<typeof ImageSourcesSettingsStatusSchema>;

export const IMAGE_SOURCE_LABELS: Record<(typeof STOCK_IMAGE_PROVIDERS)[number], string> = {
  wikimedia: "Wikimedia Commons",
  openverse: "Openverse",
  pexels: "Pexels",
  pixabay: "Pixabay",
  unsplash: "Unsplash",
  nasa: "NASA Image Library",
  met: "The Met Open Access",
  loc: "Library of Congress",
  smithsonian: "Smithsonian Open Access",
  europeana: "Europeana",
  flickr: "Flickr",
};

export const IMAGE_SOURCE_KEY_REQUIRED: Record<(typeof STOCK_IMAGE_PROVIDERS)[number], boolean> = {
  wikimedia: false,
  openverse: false,
  pexels: true,
  pixabay: true,
  unsplash: true,
  nasa: false,
  met: false,
  loc: false,
  smithsonian: true,
  europeana: true,
  flickr: true,
};
