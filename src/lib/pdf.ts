// AcreMap — Document de travail Géomètre (PDF A4 portrait)
// Module D du CDC V2 : rendu structuré pour le géomètre/expert.
// Utilise jsPDF (pure JS) — fonctionne hors ligne.
import { jsPDF } from "jspdf";
import type { Domaine, Lot, Measurement, MeasurementQA, Parcelle, SP } from "./types";
import { DEFAULT_GPS_CONFIG, polygonAreaM2, polygonPerimeterM, haversine } from "./gps";
import { refOfficielle } from "./ref";
import { formatArea } from "./format";

interface BuildArgs {
  measurement: Measurement;
  parcelle?: Parcelle | null;
  domaine?: Domaine | null;
  sp?: SP | null;
  lots?: Lot[];
  operatorName: string;
  organisation?: string;
}

function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let θ = (Math.atan2(y, x) * 180) / Math.PI;
  return (θ + 360) % 360;
}

function cardinal(deg: number) {
  const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return dirs[Math.round(deg / 45) % 8];
}

function pdfQa(m: Measurement): MeasurementQA | null {
  if (m.qa) return m.qa;
  const vals = [...m.trace, ...m.points].map((p) => p.accuracy).filter((a) => Number.isFinite(a) && a < 999).sort((a, b) => a - b);
  if (vals.length === 0 && !m.deviceProfile) return null;
  const best = m.deviceProfile?.bestAccuracyM ?? vals[0] ?? DEFAULT_GPS_CONFIG.maxAcceptableAccuracy;
  const median = m.deviceProfile?.medianAccuracyM ?? vals[Math.floor(vals.length / 2)] ?? best;
  return {
    acceptedCount: m.deviceProfile?.samplesCount ?? vals.length,
    rejectedCount: 0,
    maxAcceptableAccuracyM: DEFAULT_GPS_CONFIG.maxAcceptableAccuracy,
    bestAccuracyM: best,
    medianAccuracyM: median,
    liveAccuracyM: m.points.at(-1)?.accuracy ?? m.trace.at(-1)?.accuracy,
    history: [...m.trace.slice(-24), ...m.points.slice(-16)].slice(-40).map((p) => ({ ts: p.ts, accuracyM: p.accuracy, accepted: p.accuracy <= DEFAULT_GPS_CONFIG.maxAcceptableAccuracy })),
  };
}

export function buildGeometrePdf(args: BuildArgs): Blob {
  const { measurement: m, parcelle, domaine, sp, lots = [], operatorName, organisation = "AgriCapital SARL" } = args;
  const qa = pdfQa(m);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 12;
  let y = M;

  const reference = parcelle && domaine && sp
    ? refOfficielle({ spCode: sp.code, domCode: domaine.code, parcCode: parcelle.code })
    : `MES-${m.id.slice(0, 8).toUpperCase()}`;

  // ====== EN-TÊTE ======
  doc.setFillColor(58, 122, 42); // primary
  doc.rect(0, 0, W, 22, "F");
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("AcreMap", M, 10);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Document de travail — Levé topographique opérationnel", M, 16);
  doc.setFontSize(8);
  doc.text(organisation, W - M, 10, { align: "right" });
  doc.text(`Réf : ${reference}`, W - M, 16, { align: "right" });
  doc.setTextColor(0);
  y = 28;

  // ====== BLOC IDENTIFICATION ======
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("1. Identification de la parcelle", M, y);
  y += 5;
  doc.setDrawColor(220);
  doc.line(M, y, W - M, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const idRows: [string, string][] = [
    ["Référence officielle", reference],
    ["Sous-Préfecture", sp ? `${sp.code} — ${sp.name} (${sp.departement}, ${sp.region})` : "—"],
    ["Domaine", domaine ? `${domaine.code} — ${domaine.name}` : "—"],
    ["Parcelle", parcelle ? `${parcelle.code}` : "—"],
    ["Propriétaire", parcelle?.ownerName ?? "—"],
    ["Téléphone", parcelle?.ownerPhone ?? "—"],
    ["Type de convention", parcelle?.conventionStatus ?? "—"],
    ["Date du levé", new Date(m.createdAt).toLocaleString("fr-FR")],
    ["Opérateur", operatorName],
  ];
  for (const [k, v] of idRows) {
    doc.setTextColor(110);
    doc.text(k, M, y);
    doc.setTextColor(0);
    doc.text(String(v), M + 50, y, { maxWidth: W - M - 50 });
    y += 5;
  }

  // ====== BLOC MESURES ======
  y += 3;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("2. Résultats de la mesure", M, y);
  y += 5;
  doc.line(M, y, W - M, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const area = polygonAreaM2(m.points);
  const perim = polygonPerimeterM(m.points);
  const stats: [string, string][] = [
    ["Surface mesurée", `${formatArea(area, "ha")}  (${area.toFixed(0)} m²)`],
    ["Périmètre", `${perim.toFixed(1)} m`],
    ["Nombre de points", String(m.points.length)],
    ["QA points acceptés/rejetés", qa ? `${qa.acceptedCount} acceptés / ${qa.rejectedCount} rejetés` : "—"],
    ["Précision GPS médiane", qa ? `± ${qa.medianAccuracyM.toFixed(1)} m` : "—"],
    ["Meilleure précision observée", qa ? `± ${qa.bestAccuracyM.toFixed(1)} m` : "—"],
    ["Dernière précision live", qa?.liveAccuracyM != null ? `± ${qa.liveAccuracyM.toFixed(1)} m` : "—"],
    ["Seuil d'acceptation GPS", qa ? `≤ ${qa.maxAcceptableAccuracyM.toFixed(0)} m` : "—"],
    ["Profil GPS estimé", m.deviceProfile?.estimatedTier ?? "—"],
    ["Statut", m.status],
  ];
  for (const [k, v] of stats) {
    doc.setTextColor(110);
    doc.text(k, M, y);
    doc.setTextColor(0);
    doc.text(String(v), M + 50, y);
    y += 5;
  }

  // ====== PLAN SCHÉMATIQUE ======
  y += 4;
  if (y > H - 110) { doc.addPage(); y = M; }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("3. Plan schématique", M, y);
  y += 5;
  doc.line(M, y, W - M, y);
  y += 3;

  const planSize = Math.min(W - 2 * M, 110);
  const planX = M;
  const planY = y;
  doc.setDrawColor(180);
  doc.rect(planX, planY, planSize, planSize);

  if (m.points.length >= 3) {
    const lats = m.points.map((p) => p.lat);
    const lngs = m.points.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const dx = (maxLng - minLng) * cosLat;
    const dy = maxLat - minLat;
    const span = Math.max(dx, dy) * 1.1 || 1;
    const cx = (minLng + maxLng) / 2;
    const cy = (minLat + maxLat) / 2;
    const project = (p: { lat: number; lng: number }) => {
      const px = planX + planSize / 2 + ((p.lng - cx) * cosLat / span) * planSize * 0.9;
      const py = planY + planSize / 2 - ((p.lat - cy) / span) * planSize * 0.9;
      return [px, py] as [number, number];
    };

    // Polygone
    doc.setDrawColor(58, 122, 42);
    doc.setFillColor(74, 143, 54);
    doc.setLineWidth(0.4);
    const pts = m.points.map(project);
    const poly: any[] = pts.map(([x, y2], i) => i === 0 ? [x, y2] : [x - pts[i - 1][0], y2 - pts[i - 1][1]]);
    (doc as any).lines(poly.slice(1), pts[0][0], pts[0][1], [1, 1], "FD", true);

    // Numéros points
    doc.setFontSize(7);
    doc.setTextColor(0);
    pts.forEach(([x, y2], i) => {
      doc.setFillColor(58, 122, 42);
      doc.circle(x, y2, 1.5, "F");
      doc.setTextColor(255);
      doc.text(String(i + 1), x, y2 + 0.8, { align: "center" });
      doc.setTextColor(0);
    });

    // Distances par segment
    doc.setFontSize(6);
    doc.setTextColor(80);
    for (let i = 0; i < m.points.length; i++) {
      const a = m.points[i];
      const b = m.points[(i + 1) % m.points.length];
      const d = haversine(a, b);
      const [ax, ay] = project(a);
      const [bx, by] = project(b);
      doc.text(`${d.toFixed(1)} m`, (ax + bx) / 2, (ay + by) / 2 - 0.5, { align: "center" });
    }

    // Flèche Nord
    const nx = planX + planSize - 8;
    const ny = planY + 12;
    doc.setDrawColor(0, 0, 0); doc.setFillColor(0, 0, 0);
    doc.line(nx, ny + 6, nx, ny - 4);
    doc.triangle(nx - 1.5, ny - 2, nx + 1.5, ny - 2, nx, ny - 5, "F");
    doc.setFontSize(7);
    doc.text("N", nx, ny + 9, { align: "center" });
  } else {
    doc.setFontSize(9);
    doc.setTextColor(150);
    doc.text("Plan indisponible (moins de 3 points).", planX + planSize / 2, planY + planSize / 2, { align: "center" });
  }
  y = planY + planSize + 6;

  // ====== TABLEAU DES POINTS ======
  if (y > H - 60) { doc.addPage(); y = M; }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text("4. Coordonnées GPS des points", M, y);
  y += 5;
  doc.line(M, y, W - M, y);
  y += 4;
  doc.setFontSize(8);
  const cols = ["#", "Latitude", "Longitude", "Préc. ±m", "Côté (m)", "Azimut", "Type"];
  const cw = [10, 32, 32, 18, 22, 22, 30];
  let cx = M;
  doc.setFillColor(58, 122, 42);
  doc.setTextColor(255);
  doc.rect(M, y - 4, cw.reduce((a, b) => a + b), 6, "F");
  cols.forEach((c, i) => { doc.text(c, cx + 1, y); cx += cw[i]; });
  y += 4;
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");
  for (let i = 0; i < m.points.length; i++) {
    if (y > H - 18) { doc.addPage(); y = M; }
    const p = m.points[i];
    const next = m.points[(i + 1) % m.points.length];
    const dist = haversine(p, next);
    const az = bearing(p, next);
    cx = M;
    const row = [
      String(i + 1),
      p.lat.toFixed(7),
      p.lng.toFixed(7),
      `±${p.accuracy.toFixed(1)}`,
      dist.toFixed(1),
      `${az.toFixed(0)}° ${cardinal(az)}`,
      p.auto ? "auto 100m" : "marqué",
    ];
    row.forEach((r, j) => { doc.text(r, cx + 1, y); cx += cw[j]; });
    y += 4.5;
  }

  // ====== LOTS ======
  if (lots.length > 0) {
    if (y > H - 50) { doc.addPage(); y = M; }
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("5. Lots issus du morcellement", M, y);
    y += 5;
    doc.line(M, y, W - M, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Total : ${lots.length} lots — ${formatArea(lots.reduce((a, l) => a + l.areaM2, 0))}`, M, y);
    y += 5;
    for (const l of lots) {
      if (y > H - 14) { doc.addPage(); y = M; }
      doc.text(`• ${l.code} — ${formatArea(l.areaM2)}${l.assigneeName ? ` — Souscripteur : ${l.assigneeName}` : ""}`, M, y);
      y += 4.5;
    }
  }

  // ====== PIED DE PAGE / MENTION LÉGALE ======
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(220);
    doc.line(M, H - 15, W - M, H - 15);
    doc.setFontSize(7);
    doc.setTextColor(110);
    doc.setFont("helvetica", "italic");
    doc.text(
      "Document de travail — non opposable. Le bornage légal et la certification de superficie restent du ressort exclusif d'un géomètre assermenté.",
      M, H - 10, { maxWidth: W - 2 * M }
    );
    doc.setFont("helvetica", "normal");
    doc.text(`AcreMap · ${organisation}`, M, H - 5);
    doc.text(`Page ${i}/${pageCount}`, W - M, H - 5, { align: "right" });
    doc.text(`Réf : ${reference}`, W / 2, H - 5, { align: "center" });
  }

  return doc.output("blob");
}
