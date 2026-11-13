/** A point inside the largest part of a shape, near the visual centre. */

export type LngLat = [number, number];
export type LabelBox = { x: number; y: number; w: number; h: number };

function ringArea(ring: LngLat[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

export function pointInRing(lon: number, lat: number, ring: LngLat[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const denom = b[1] - a[1];
    if ((a[1] > lat) !== (b[1] > lat) && lon < ((b[0] - a[0]) * (lat - a[1])) / (denom || 1e-12) + a[0]) hit = !hit;
  }
  return hit;
}

function distToRing(lon: number, lat: number, ring: LngLat[]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((lon - a[0]) * dx + (lat - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(lon - a[0] - t * dx, lat - a[1] - t * dy));
  }
  return best;
}

/** Keeps a ring continuous across ±180 so the centre is not the middle of the Pacific. */
function unwrap(ring: LngLat[]): LngLat[] {
  if (ring.length === 0) return ring;
  const out: LngLat[] = [[ring[0]![0], ring[0]![1]]];
  for (let i = 1; i < ring.length; i += 1) {
    let lon = ring[i]![0];
    const prev = out[out.length - 1]![0];
    while (lon - prev > 180) lon -= 360;
    while (prev - lon > 180) lon += 360;
    out.push([lon, ring[i]![1]]);
  }
  return out;
}

function normLon(lon: number): number {
  let x = lon;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return Math.round(x * 1000) / 1000;
}

/**
 * Grid point inside the largest ring, in the middle 60% of that ring's box,
 * inset from the border. A pole-of-inaccessibility search on Vietnam lands in
 * the wide north; this stays near the centre of the shape.
 */
export function visualLabelPoint(polygons: LngLat[][][]): LngLat {
  const exteriors = polygons
    .map((poly) => unwrap(poly[0] ?? []))
    .filter((ring) => ring.length > 2)
    .sort((a, b) => ringArea(b) - ringArea(a));
  const ring = exteriors[0];
  if (!ring) return [0, 0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const steps = 36;
  const pts: { x: number; y: number; clear: number }[] = [];
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      const x = minX + ((maxX - minX) * i) / steps;
      const y = minY + ((maxY - minY) * j) / steps;
      if (!pointInRing(x, y, ring)) continue;
      pts.push({ x, y, clear: distToRing(x, y, ring) });
    }
  }
  if (pts.length === 0) return [normLon(cx), Math.round(cy * 1000) / 1000];
  const x0 = minX + (maxX - minX) * 0.2;
  const x1 = maxX - (maxX - minX) * 0.2;
  const y0 = minY + (maxY - minY) * 0.2;
  const y1 = maxY - (maxY - minY) * 0.2;
  const band = pts.filter((point) => point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1);
  const pool = band.length > 0 ? band : pts;
  const poolMax = pool.reduce((max, point) => Math.max(max, point.clear), 0);
  const need = poolMax * 0.45;
  let best = pool[0]!;
  let score = -Infinity;
  for (const point of pool) {
    if (point.clear < need) continue;
    const next = -Math.hypot(point.x - cx, point.y - cy) / span + 0.35 * (point.clear / (poolMax || 1));
    if (next > score) {
      score = next;
      best = point;
    }
  }
  return [normLon(best.x), Math.round(best.y * 1000) / 1000];
}

export function labelFromGeometry(geometry: { type: string; coordinates: unknown }): LngLat {
  if (geometry.type === "Polygon") return visualLabelPoint([geometry.coordinates as LngLat[][]]);
  if (geometry.type === "MultiPolygon") return visualLabelPoint(geometry.coordinates as LngLat[][][]);
  return [0, 0];
}

export function boxesOverlap(a: LabelBox, b: LabelBox, gap = 0): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w > b.x - gap && a.y < b.y + b.h + gap && a.y + a.h > b.y - gap;
}

/** Larger rank wins. A later label that overlaps an earlier one is hidden. */
export function visibleLabelIndexes(items: { box: LabelBox; rank: number }[], gap = 0): boolean[] {
  const order = items
    .map((item, index) => ({ index, rank: item.rank }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index);
  const visible = items.map(() => false);
  const placed: LabelBox[] = [];
  for (const item of order) {
    const box = items[item.index]!.box;
    if (placed.some((other) => boxesOverlap(box, other, gap))) continue;
    visible[item.index] = true;
    placed.push(box);
  }
  return visible;
}
