// Auto-morcellement: split a parcel polygon into ~1ha lots using a grid sweep.
// Frontend implementation with Turf — produces ordered lots H01..HNN.
import * as turf from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import { polygonAreaM2 } from "./gps";

export interface MorcResult {
  lots: { code: string; polygon: { lat: number; lng: number }[]; areaM2: number }[];
  totalAreaM2: number;
  voiePrincipale?: { lat: number; lng: number }[];
}

export function morceler(
  perimeter: { lat: number; lng: number }[],
  lotAreaHa = 1
): MorcResult {
  if (perimeter.length < 3) return { lots: [], totalAreaM2: 0 };
  const ring = [...perimeter, perimeter[0]].map((p) => [p.lng, p.lat]);
  const poly = turf.polygon([ring]);
  const totalAreaM2 = polygonAreaM2(perimeter);
  const lotSide = Math.sqrt(lotAreaHa * 10_000); // ~100m for 1ha

  // Build a grid in metric (web mercator approx via centroid)
  const bbox = turf.bbox(poly);
  const cellKm = lotSide / 1000;
  const grid = turf.squareGrid(bbox, cellKm, { units: "kilometers" });

  const lots: MorcResult["lots"] = [];
  let idx = 1;
  for (const cell of grid.features) {
    try {
      const inter = turf.intersect(turf.featureCollection([poly, cell as Feature<Polygon>]));
      if (!inter) continue;
      const geom = inter.geometry;
      const coordsArr: number[][][] =
        geom.type === "Polygon"
          ? [geom.coordinates[0]]
          : geom.type === "MultiPolygon"
          ? geom.coordinates.map((c) => c[0])
          : [];
      for (const ring of coordsArr) {
        const pts = ring.map(([lng, lat]) => ({ lat, lng }));
        const area = polygonAreaM2(pts);
        if (area < 800) continue; // ignore tiny slivers <0.08 ha
        lots.push({
          code: `H${String(idx).padStart(2, "0")}`,
          polygon: pts,
          areaM2: area,
        });
        idx++;
      }
    } catch {
      // intersection edge case — skip cell
    }
  }
  // Sort: top-to-bottom, left-to-right (by centroid)
  lots.sort((a, b) => {
    const ca = centroid(a.polygon);
    const cb = centroid(b.polygon);
    if (Math.abs(ca.lat - cb.lat) > 0.0001) return cb.lat - ca.lat;
    return ca.lng - cb.lng;
  });
  // Renumber
  lots.forEach((l, i) => (l.code = `H${String(i + 1).padStart(2, "0")}`));
  return { lots, totalAreaM2 };
}

function centroid(pts: { lat: number; lng: number }[]) {
  const s = pts.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: s.lat / pts.length, lng: s.lng / pts.length };
}
