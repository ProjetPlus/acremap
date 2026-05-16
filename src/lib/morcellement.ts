// Morcellement strict — bandes parallèles à la voie principale,
// chaque lot ajusté par bissection pour atteindre exactement N hectares.
import * as turf from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import { polygonAreaM2 } from "./gps";
import type { Pt, Axis } from "./partage";

export interface MorcLot { code: string; polygon: Pt[]; areaM2: number }
export interface MorcResult {
  lots: MorcLot[];
  reste: { polygon: Pt[]; areaM2: number }[];
  totalAreaM2: number;
  lotAreaTargetM2: number;
}

function ringFromPts(pts: Pt[]): number[][] {
  return [...pts, pts[0]].map((p) => [p.lng, p.lat]);
}
function ptsFromCoords(coords: number[][]): Pt[] {
  const arr = coords.map(([lng, lat]) => ({ lng, lat }));
  if (arr.length > 1 && arr[0].lat === arr.at(-1)!.lat && arr[0].lng === arr.at(-1)!.lng) arr.pop();
  return arr;
}
function extractPolys(f: Feature<Polygon | MultiPolygon> | null): Pt[][] {
  if (!f) return [];
  const g = f.geometry;
  if (g.type === "Polygon") return [ptsFromCoords(g.coordinates[0])];
  return g.coordinates.map((c) => ptsFromCoords(c[0]));
}
function diffSafe(a: Feature<Polygon | MultiPolygon>, b: Feature<Polygon | MultiPolygon>) {
  try { return turf.difference(turf.featureCollection([a, b])); } catch { return null; }
}
function intersectSafe(a: Feature<Polygon | MultiPolygon>, b: Feature<Polygon | MultiPolygon>) {
  try { return turf.intersect(turf.featureCollection([a, b])); } catch { return null; }
}

/**
 * Découpe un polygone (déjà privé de la voie si besoin) en lots stricts de N ha
 * via des bandes parallèles à `axis` (axe long de la voie).
 * Le reste éventuel est exposé séparément.
 */
export function morcelerStrict(
  perimeter: Pt[],
  lotAreaHa = 1,
  axis: Axis = "horizontal",
): MorcResult {
  const targetM2 = lotAreaHa * 10_000;
  if (perimeter.length < 3) {
    return { lots: [], reste: [], totalAreaM2: 0, lotAreaTargetM2: targetM2 };
  }
  const ring = ringFromPts(perimeter);
  const initialPoly = turf.polygon([ring]) as Feature<Polygon>;
  const totalAreaM2 = polygonAreaM2(perimeter);
  const lots: MorcLot[] = [];
  const reste: { polygon: Pt[]; areaM2: number }[] = [];

  let remaining: Feature<Polygon | MultiPolygon> | null = initialPoly;
  let iter = 0;
  // axis "horizontal" → voie horizontale → bandes empilées verticalement (cut sur Y)
  // axis "vertical" → cut sur X
  while (remaining && iter < 200) {
    const remArea = polygonAreaM2(extractPolys(remaining)[0] ?? []);
    if (remArea < targetM2 * 0.95) break;
    const bbox = turf.bbox(remaining);
    const [minX, minY, maxX, maxY] = bbox;
    let lo = axis === "horizontal" ? minY : minX;
    let hi = axis === "horizontal" ? maxY : maxX;
    let bandFeature: Feature<Polygon | MultiPolygon> | null = null;
    let bandArea = 0;
    for (let bi = 0; bi < 28; bi++) {
      const mid = (lo + hi) / 2;
      const cutBox: Feature<Polygon> = axis === "horizontal"
        ? turf.polygon([[[minX - 1, minY - 1], [maxX + 1, minY - 1], [maxX + 1, mid], [minX - 1, mid], [minX - 1, minY - 1]]])
        : turf.polygon([[[minX - 1, minY - 1], [mid, minY - 1], [mid, maxY + 1], [minX - 1, maxY + 1], [minX - 1, minY - 1]]]);
      const inter = intersectSafe(remaining, cutBox) as any;
      const area = extractPolys(inter).reduce((s, p) => s + polygonAreaM2(p), 0);
      if (Math.abs(area - targetM2) / targetM2 < 0.005) { bandFeature = inter; bandArea = area; break; }
      if (area > targetM2) hi = mid; else lo = mid;
      bandFeature = inter; bandArea = area;
    }
    if (!bandFeature || bandArea < targetM2 * 0.95) break;
    // Take the largest piece if multipolygon
    const polys = extractPolys(bandFeature);
    polys.sort((a, b) => polygonAreaM2(b) - polygonAreaM2(a));
    const best = polys[0];
    const code = `H${String(lots.length + 1).padStart(2, "0")}`;
    lots.push({ code, polygon: best, areaM2: polygonAreaM2(best) });
    // subtract
    const rest = diffSafe(remaining, bandFeature) as Feature<Polygon | MultiPolygon> | null;
    remaining = rest;
    iter++;
  }
  if (remaining) {
    for (const p of extractPolys(remaining)) {
      const a = polygonAreaM2(p);
      if (a > 50) reste.push({ polygon: p, areaM2: a });
    }
  }
  return { lots, reste, totalAreaM2, lotAreaTargetM2: targetM2 };
}

// Rétro-compat avec ancien appel `morceler(perimeter, lotHa)`
export function morceler(perimeter: Pt[], lotAreaHa = 1) {
  const r = morcelerStrict(perimeter, lotAreaHa, "horizontal");
  return { lots: r.lots, totalAreaM2: r.totalAreaM2 };
}
