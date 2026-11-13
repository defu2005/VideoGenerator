import { readFileSync } from "node:fs";
import { join } from "node:path";
import { labelFromGeometry, type LngLat } from "@vg/shared";
import { composeAssetRoot } from "../hyperframes.js";

/** Committed Natural Earth extract. See assets/compose/map/README.md. */

const GEO_MAX_BYTES = 150 * 1024;

type Box = [number, number, number, number];

type MapFeature = {
  type: "Feature";
  properties: {
    id: string;
    name: string;
    name_en?: string;
    name_vi?: string;
    level?: 0 | 1;
    parent?: string;
    label?: LngLat;
  };
  geometry: { type: string; coordinates: unknown };
};

export type MapCollection = { type: "FeatureCollection"; features: MapFeature[] };

let world: MapFeature[] | null = null;
let provinces: MapFeature[] | null = null;

function load(name: string): MapFeature[] {
  const parsed = JSON.parse(readFileSync(join(composeAssetRoot(), "map", name), "utf8")) as MapCollection;
  return parsed.features;
}

export function mapCatalog(): { world: MapFeature[]; provinces: MapFeature[] } {
  world ??= load("world.json");
  provinces ??= load("vn.json");
  return { world, provinces };
}

function bbox(feature: MapFeature): Box {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const walk = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      west = Math.min(west, value[0]);
      south = Math.min(south, value[1]);
      east = Math.max(east, value[0]);
      north = Math.max(north, value[1]);
      return;
    }
    for (const item of value) walk(item);
  };
  walk(feature.geometry.coordinates);
  if (!Number.isFinite(west)) return [0, 0, 0, 0];
  return [west, south, east, north];
}

function overlaps(a: Box, b: Box): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function expand(box: Box, factor: number): Box {
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  const halfW = Math.max(((box[2] - box[0]) * factor) / 2, 0.4);
  const halfH = Math.max(((box[3] - box[1]) * factor) / 2, 0.4);
  return [cx - halfW, cy - halfH, cx + halfW, cy + halfH];
}

function center(box: Box): LngLat {
  return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}

function withLabel(feature: MapFeature): MapFeature {
  if (feature.properties.label) return feature;
  return {
    ...feature,
    properties: { ...feature.properties, label: labelFromGeometry(feature.geometry) },
  };
}

function dedupe(features: MapFeature[]): MapFeature[] {
  const seen = new Set<string>();
  const out: MapFeature[] = [];
  for (const feature of features) {
    if (seen.has(feature.properties.id)) continue;
    seen.add(feature.properties.id);
    out.push(feature);
  }
  return out;
}

function geoBytes(features: MapFeature[]): number {
  return Buffer.byteLength(JSON.stringify({ type: "FeatureCollection", features }));
}

function trim(features: MapFeature[], keep: Set<string>): MapFeature[] {
  let current = features;
  while (current.length > keep.size && geoBytes(current) > GEO_MAX_BYTES) {
    const originFeature = current.find((feature) => keep.has(feature.properties.id));
    const origin = originFeature ? center(bbox(originFeature)) : [0, 0];
    let drop = -1;
    let far = -1;
    current.forEach((feature, index) => {
      if (keep.has(feature.properties.id)) return;
      const at = center(bbox(feature));
      const dist = Math.hypot(at[0] - origin[0], at[1] - origin[1]);
      if (dist > far) {
        far = dist;
        drop = index;
      }
    });
    if (drop < 0) break;
    current = current.filter((_, index) => index !== drop);
  }
  return current;
}

export type MapShotFields = {
  focus?: string;
  pin?: LngLat;
  from?: string | [number, number, number, number];
  zoomFrom?: number;
  spanDeg?: number;
  geo?: { features?: MapFeature[] };
};

function viewOf(source: MapShotFields, focus: MapFeature | undefined, pool: MapFeature[]): Box | null {
  if (Array.isArray(source.from)) return source.from;
  if (typeof source.from === "string") {
    const from = pool.find((feature) => feature.properties.id === source.from);
    if (from) return expand(bbox(from), 1.2);
  }
  if (focus) return expand(bbox(focus), source.zoomFrom ?? 3.2);
  if (source.pin && source.spanDeg) {
    const half = source.spanDeg / 2;
    return [source.pin[0] - half, source.pin[1] - half, source.pin[0] + half, source.pin[1] + half];
  }
  return null;
}

/**
 * The geo sent to the template. A country scene drops provinces and features
 * outside the opening view. A province scene sends the province and its parent.
 * The pin is the baked label point, which sits near the visual centre.
 */
export function prepareMapGeo(source: MapShotFields): { geo: MapCollection; pin?: LngLat } {
  const catalog = mapCatalog();
  const supplied = source.geo?.features?.length ? source.geo.features : null;
  const province = supplied ? null : catalog.provinces.find((feature) => feature.properties.id === source.focus);
  const pool = (supplied ?? (province ? dedupe([province, ...catalog.world]) : catalog.world)).map(withLabel);
  const focus = pool.find((feature) => feature.properties.id === source.focus);
  const level = focus?.properties.level ?? (province ? 1 : 0);
  const parentId = (typeof source.from === "string" ? source.from : undefined) ?? focus?.properties.parent;
  let chosen = pool;
  if (level >= 1 && focus) {
    const parent = pool.find((feature) => feature.properties.id === parentId)
      ?? catalog.world.find((feature) => feature.properties.id === (parentId ?? "VN"));
    chosen = [focus, ...(parent ? [withLabel(parent)] : [])];
  } else {
    chosen = pool.filter((feature) => (feature.properties.level ?? 0) === 0);
    if (focus && !chosen.some((feature) => feature.properties.id === focus.properties.id)) chosen = [focus, ...chosen];
    const view = viewOf(source, focus, chosen);
    if (view) chosen = chosen.filter((feature) => feature.properties.id === focus?.properties.id || overlaps(bbox(feature), view));
  }
  const keep = new Set([focus?.properties.id, parentId].filter((id): id is string => Boolean(id)));
  chosen = trim(dedupe(chosen), keep);
  const pin = source.pin ?? focus?.properties.label;
  return { geo: { type: "FeatureCollection", features: chosen }, ...(pin ? { pin } : {}) };
}
