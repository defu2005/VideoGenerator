/**
 * Minimum-cost assignment (Hungarian / Kuhn–Munkres).
 * The algorithm follows the Apache-2.0 description used by munkres-js
 * (https://github.com/addaleax/munkres-js). This file is an independent
 * implementation, not a copy of that project.
 */

export function assignOptimal(cost: number[][]): number[] {
  const rows = cost.length;
  const cols = cost[0]?.length ?? 0;
  const n = Math.max(rows, cols);
  if (n === 0) return [];
  const matrix = Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, col) => {
    const value = cost[row]?.[col];
    return value === undefined ? 0 : value;
  }));
  const u = Array(n + 1).fill(0);
  const v = Array(n + 1).fill(0);
  const p = Array(n + 1).fill(0);
  const way = Array(n + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(n + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const cur = matrix[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const assignment = Array(rows).fill(-1);
  for (let j = 1; j <= n; j += 1) {
    const row = p[j] - 1;
    const col = j - 1;
    if (row >= 0 && row < rows && col < cols) assignment[row] = col;
  }
  return assignment;
}
