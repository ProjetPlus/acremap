// AcreMap — Plan Géomètre mono-page (capture 2 like).
// Format A3 paysage par défaut, 3 colonnes : infos | plan UTM | légende+coords.
import { jsPDF } from "jspdf";
import proj4 from "proj4";
import type { Domaine, Lot, Measurement, Parcelle, SP } from "./types";
import { polygonAreaM2, polygonPerimeterM, haversine } from "./gps";
import { refOfficielle } from "./ref";
import { formatArea } from "./format";
import logo from "../assets/agricapital-logo.jpg";

interface BuildArgs {
  measurement: Measurement;
  parcelle?: Parcelle | null;
  domaine?: Domaine | null;
  sp?: SP | null;
  lots?: Lot[];
  voie?: { lat: number; lng: number }[][];
  operatorName: string;
  organisation?: string;
  format?: "a4" | "a3" | "a2" | "a1";
}

function utmZone(lng: number) { return Math.floor((lng + 180) / 6) + 1; }

export function buildGeometrePdf(args: BuildArgs): Blob {
  const {
    measurement: m, parcelle, domaine, sp, lots = [], voie = [],
    operatorName, organisation = "AgriCapital SARL",
    format = "a3",
  } = args;

  const doc = new jsPDF({ unit: "mm", format, orientation: "landscape" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 8;

  const reference = parcelle && domaine && sp
    ? refOfficielle({ spCode: sp.code, domCode: domaine.code, parcCode: parcelle.code })
    : `MES-${m.id.slice(0, 8).toUpperCase()}`;

  // ===== En-tête bandeau =====
  doc.setFillColor(58, 122, 42);
  doc.rect(0, 0, W, 16, "F");
  try { doc.addImage(logo, "JPEG", M, 2, 12, 12); } catch { /* ignore */ }
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text("PLAN PARCELLAIRE — AcreMap", M + 16, 8);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text(`${organisation}  ·  Réf : ${reference}`, M + 16, 13);
  doc.setFontSize(8);
  doc.text(`Format ${format.toUpperCase()} · Échelle auto · Projection UTM WGS84`, W - M, 8, { align: "right" });
  doc.text(new Date().toLocaleString("fr-FR"), W - M, 13, { align: "right" });
  doc.setTextColor(0);

  // ===== Layout 3 colonnes =====
  const top = 18;
  const bottom = H - M;
  const colLeft = 78;
  const colRight = 95;
  const planX = M + colLeft + 4;
  const planY = top;
  const planW = W - 2 * M - colLeft - colRight - 8;
  const planH = bottom - top - 4;

  // ===== COLONNE GAUCHE — informations =====
  let y = top;
  const lx = M;
  doc.setFontSize(10); doc.setFont("helvetica", "bold");
  box(doc, lx, y, colLeft, 6, "Informations générales");
  y += 8;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  const idRows: [string, string][] = [
    ["Référence", reference],
    ["Sous-Préfecture", sp ? `${sp.name} (${sp.departement})` : "—"],
    ["Région / District", sp ? `${sp.region} / ${sp.district}` : "—"],
    ["Domaine", domaine ? `${domaine.code} — ${domaine.name}` : "—"],
    ["Parcelle", parcelle?.code ?? "—"],
    ["Propriétaire", parcelle?.ownerName ?? "—"],
    ["Téléphone", parcelle?.ownerPhone ?? "—"],
    ["Convention", parcelle?.conventionStatus ?? "—"],
    ["Date du levé", new Date(m.createdAt).toLocaleDateString("fr-FR")],
    ["Opérateur", operatorName],
    ["Statut", m.status],
  ];
  for (const [k, v] of idRows) {
    doc.setTextColor(110); doc.text(k, lx + 1, y);
    doc.setTextColor(0); doc.text(String(v), lx + 30, y, { maxWidth: colLeft - 31 });
    y += 4.5;
  }

  y += 3;
  box(doc, lx, y, colLeft, 6, "Surfaces");
  y += 8;
  const totalArea = polygonAreaM2(m.points);
  const perim = polygonPerimeterM(m.points);
  const lotsArea = lots.reduce((s, l) => s + l.areaM2, 0);
  const voieArea = voie.reduce((s, v) => s + polygonAreaM2(v), 0);
  const reste = Math.max(0, totalArea - lotsArea - voieArea);
  const surfRows: [string, string][] = [
    ["Surface totale", `${formatArea(totalArea, "ha")}  (${totalArea.toFixed(0)} m²)`],
    ["Périmètre", `${perim.toFixed(1)} m`],
    ["Nb lots", String(lots.length)],
    ["Surface lots", formatArea(lotsArea)],
    ["Surface voie", voie.length ? formatArea(voieArea) : "—"],
    ["Reste", reste > 50 ? formatArea(reste) : "—"],
    ["Précision médiane", m.qa ? `± ${m.qa.medianAccuracyM.toFixed(1)} m` : "—"],
    ["Meilleure précision", m.qa ? `± ${m.qa.bestAccuracyM.toFixed(1)} m` : "—"],
  ];
  for (const [k, v] of surfRows) {
    doc.setTextColor(110); doc.text(k, lx + 1, y);
    doc.setTextColor(0); doc.text(v, lx + 30, y);
    y += 4.5;
  }

  y += 3;
  box(doc, lx, y, colLeft, 6, "Mention légale");
  y += 7;
  doc.setFontSize(7); doc.setTextColor(80);
  doc.text(
    "Document de travail — non opposable. Le bornage légal et la certification de superficie restent du ressort exclusif d'un géomètre assermenté.",
    lx + 1, y, { maxWidth: colLeft - 2 }
  );

  // ===== COLONNE CENTRALE — plan =====
  doc.setDrawColor(120); doc.setLineWidth(0.3);
  doc.rect(planX - 2, planY - 1, planW + 4, planH + 2);

  let utmZ = 30, north = true;
  let projDef = "+proj=utm +zone=30 +north +datum=WGS84 +units=m +no_defs";
  if (m.points.length >= 3) {
    utmZ = utmZone(m.points[0].lng);
    north = m.points[0].lat >= 0;
    projDef = `+proj=utm +zone=${utmZ} ${north ? "+north" : "+south"} +datum=WGS84 +units=m +no_defs`;
    const utmPoints = m.points.map((p) => proj4("WGS84", projDef, [p.lng, p.lat]) as [number, number]);
    const allUtm: [number, number][] = [...utmPoints];
    for (const l of lots) for (const p of l.polygon) allUtm.push(proj4("WGS84", projDef, [p.lng, p.lat]) as [number, number]);
    const xs = allUtm.map((p) => p[0]); const ys = allUtm.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const dx = maxX - minX, dy = maxY - minY;
    const pad = 0.06;
    const sx = (planW - 8) / (dx * (1 + pad));
    const sy = (planH - 14) / (dy * (1 + pad));
    const scale = Math.min(sx, sy);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const project = (x: number, y2: number): [number, number] => [
      planX + planW / 2 + (x - cx) * scale,
      planY + planH / 2 - (y2 - cy) * scale,
    ];

    // Grille UTM
    doc.setDrawColor(220); doc.setLineWidth(0.1);
    const gridStep = niceStep((Math.max(dx, dy)) / 6);
    const gx0 = Math.ceil(minX / gridStep) * gridStep;
    const gy0 = Math.ceil(minY / gridStep) * gridStep;
    doc.setFontSize(5); doc.setTextColor(140);
    for (let gx = gx0; gx <= maxX; gx += gridStep) {
      const [px, py1] = project(gx, minY);
      const [, py2] = project(gx, maxY);
      doc.line(px, py1, px, py2);
      doc.text(`${gx.toFixed(0)}`, px, planY + planH - 1, { align: "center" });
    }
    for (let gy = gy0; gy <= maxY; gy += gridStep) {
      const [px1, py] = project(minX, gy);
      const [px2] = project(maxX, gy);
      doc.line(px1, py, px2, py);
      doc.text(`${gy.toFixed(0)}`, planX + 1, py, { align: "left", baseline: "middle" });
    }

    // Voie (marron)
    doc.setFillColor(150, 100, 60); doc.setDrawColor(110, 70, 40); doc.setLineWidth(0.3);
    for (const v of voie) {
      if (v.length < 3) continue;
      const pts = v.map((p) => project(...(proj4("WGS84", projDef, [p.lng, p.lat]) as [number, number])));
      drawPoly(doc, pts, "F");
    }

    // Lots (couleurs cyclées)
    const palette = [[200, 230, 200], [200, 220, 240], [240, 220, 200], [230, 210, 240], [220, 240, 220], [240, 230, 200]];
    doc.setLineWidth(0.25);
    lots.forEach((l, i) => {
      if (l.polygon.length < 3) return;
      const c = palette[i % palette.length];
      doc.setFillColor(c[0], c[1], c[2]); doc.setDrawColor(80, 120, 80);
      const pts = l.polygon.map((p) => project(...(proj4("WGS84", projDef, [p.lng, p.lat]) as [number, number])));
      drawPoly(doc, pts, "FD");
      const cx2 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy2 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      doc.setTextColor(40); doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text(l.code, cx2, cy2, { align: "center" });
      doc.setFontSize(5); doc.setFont("helvetica", "normal");
      doc.text(formatArea(l.areaM2), cx2, cy2 + 2.5, { align: "center" });
    });

    // Polygone parcelle (contour)
    doc.setDrawColor(58, 122, 42); doc.setLineWidth(0.6); doc.setFillColor(255, 255, 255);
    const parcPts = utmPoints.map(([x, y2]) => project(x, y2));
    drawPoly(doc, parcPts, "S");

    // Bornes A1..An
    doc.setFontSize(6); doc.setFont("helvetica", "bold");
    parcPts.forEach(([x, y2], i) => {
      doc.setFillColor(220, 30, 30); doc.circle(x, y2, 1.1, "F");
      doc.setTextColor(0); doc.text(`A${i + 1}`, x + 1.6, y2 - 1.2);
    });

    // Distances par segment
    doc.setFontSize(5); doc.setTextColor(60); doc.setFont("helvetica", "normal");
    for (let i = 0; i < m.points.length; i++) {
      const a = m.points[i], b = m.points[(i + 1) % m.points.length];
      const d = haversine(a, b);
      const [ax, ay] = parcPts[i], [bx, by] = parcPts[(i + 1) % parcPts.length];
      doc.text(`${d.toFixed(1)} m`, (ax + bx) / 2, (ay + by) / 2 - 0.5, { align: "center" });
    }

    // Flèche Nord
    const nx = planX + planW - 8, ny = planY + 10;
    doc.setDrawColor(0, 0, 0); doc.setFillColor(0, 0, 0);
    doc.line(nx, ny + 5, nx, ny - 4);
    doc.triangle(nx - 1.5, ny - 2, nx + 1.5, ny - 2, nx, ny - 5, "F");
    doc.setFontSize(7); doc.text("N", nx, ny + 8, { align: "center" });

    // Échelle graphique
    const scaleM = niceStep((maxX - minX) / 5);
    const sxLen = scaleM * scale;
    const sx0 = planX + 4, sy0 = planY + planH - 6;
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
    doc.line(sx0, sy0, sx0 + sxLen, sy0);
    doc.line(sx0, sy0 - 1, sx0, sy0 + 1);
    doc.line(sx0 + sxLen, sy0 - 1, sx0 + sxLen, sy0 + 1);
    doc.setFontSize(6); doc.text(`${scaleM} m`, sx0 + sxLen / 2, sy0 - 1.5, { align: "center" });
  } else {
    doc.setFontSize(10); doc.setTextColor(150);
    doc.text("Plan indisponible (moins de 3 points).", planX + planW / 2, planY + planH / 2, { align: "center" });
  }

  // ===== COLONNE DROITE — légende + tables =====
  const rx = W - M - colRight;
  let ry = top;
  box(doc, rx, ry, colRight, 6, "Légende");
  ry += 8;
  doc.setFontSize(7); doc.setFont("helvetica", "normal");
  legendRow(doc, rx, ry, [58, 122, 42], "Limite parcelle"); ry += 4.5;
  legendRow(doc, rx, ry, [150, 100, 60], "Voie principale"); ry += 4.5;
  legendRow(doc, rx, ry, [200, 230, 200], "Lots morcelés"); ry += 4.5;
  legendRow(doc, rx, ry, [220, 30, 30], "Bornes A1..An"); ry += 4.5;
  legendRow(doc, rx, ry, [220, 220, 220], `Grille UTM ${utmZ}${north ? "N" : "S"} (m)`); ry += 6;

  if (lots.length > 0) {
    box(doc, rx, ry, colRight, 6, `Lots (${lots.length})`); ry += 7;
    doc.setFontSize(6.5); doc.setFont("helvetica", "bold");
    doc.text("Code", rx + 1, ry); doc.text("Surface", rx + 14, ry); doc.text("Souscripteur", rx + 35, ry);
    ry += 3; doc.setDrawColor(200); doc.line(rx, ry, rx + colRight, ry); ry += 1;
    doc.setFont("helvetica", "normal");
    for (const l of lots) {
      if (ry > bottom - 60) break;
      doc.text(l.code, rx + 1, ry);
      doc.text(formatArea(l.areaM2), rx + 14, ry);
      doc.text(l.assigneeName ?? "—", rx + 35, ry, { maxWidth: colRight - 36 });
      ry += 3.6;
    }
    ry += 2;
  }

  // Coordonnées UTM des bornes
  if (m.points.length > 0 && ry < bottom - 30) {
    box(doc, rx, ry, colRight, 6, `Coordonnées UTM ${utmZ}${north ? "N" : "S"}`); ry += 7;
    doc.setFontSize(6.5); doc.setFont("helvetica", "bold");
    doc.text("Pt", rx + 1, ry); doc.text("X (E)", rx + 12, ry); doc.text("Y (N)", rx + 36, ry); doc.text("±m", rx + 64, ry);
    ry += 3; doc.line(rx, ry, rx + colRight, ry); ry += 1;
    doc.setFont("helvetica", "normal");
    for (let i = 0; i < m.points.length; i++) {
      if (ry > bottom - 4) break;
      const p = m.points[i];
      const [x, y2] = proj4("WGS84", projDef, [p.lng, p.lat]) as [number, number];
      doc.text(`A${i + 1}`, rx + 1, ry);
      doc.text(x.toFixed(2), rx + 12, ry);
      doc.text(y2.toFixed(2), rx + 36, ry);
      doc.text(`±${p.accuracy.toFixed(1)}`, rx + 64, ry);
      ry += 3.4;
    }
  }

  // ===== Pied =====
  doc.setDrawColor(220); doc.line(M, H - 4, W - M, H - 4);
  doc.setFontSize(6); doc.setTextColor(110);
  doc.text(`AcreMap · ${organisation} · Réf ${reference}`, M, H - 1.5);
  doc.text(`Page 1/1`, W - M, H - 1.5, { align: "right" });

  return doc.output("blob");
}

function box(doc: jsPDF, x: number, y: number, w: number, h: number, title: string) {
  doc.setFillColor(58, 122, 42); doc.rect(x, y, w, h, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
  doc.text(title, x + 2, y + h - 1.6);
  doc.setTextColor(0);
}

function legendRow(doc: jsPDF, x: number, y: number, color: number[], label: string) {
  doc.setFillColor(color[0], color[1], color[2]); doc.setDrawColor(80);
  doc.rect(x + 1, y - 2.6, 4, 3, "FD");
  doc.setTextColor(0); doc.setFontSize(7); doc.text(label, x + 7, y);
}

function drawPoly(doc: jsPDF, pts: [number, number][], style: "F" | "S" | "FD") {
  if (pts.length < 2) return;
  const lines = pts.slice(1).map(([x, y], i) => [x - pts[i][0], y - pts[i][1]] as [number, number]);
  (doc as any).lines(lines, pts[0][0], pts[0][1], [1, 1], style, true);
}

function niceStep(approx: number): number {
  if (approx <= 0) return 10;
  const exp = Math.pow(10, Math.floor(Math.log10(approx)));
  const f = approx / exp;
  let nice: number;
  if (f < 1.5) nice = 1; else if (f < 3) nice = 2; else if (f < 7) nice = 5; else nice = 10;
  return nice * exp;
}
