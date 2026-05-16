import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { MapView } from "@/components/MapView";
import { db, isBrowser } from "@/lib/db";
import { useAuth, hasRole } from "@/lib/auth";
import { formatArea, formatDate } from "@/lib/format";
import { morcelerStrict } from "@/lib/morcellement";
import { partagerParcelle, type Axis } from "@/lib/partage";
import { genererVoie } from "@/lib/voie";
import { refOfficielle } from "@/lib/ref";
import { downloadBlob, toCSV, toGeoJSON, toKML } from "@/lib/export";
import { buildGeometrePdf } from "@/lib/pdf";
import { buildDxf } from "@/lib/dxf";
import { buildShapefileZip } from "@/lib/shp";
import { DEFAULT_GPS_CONFIG, haversine, polygonAreaM2, polygonPerimeterM } from "@/lib/gps";
import type { DeviceProfile, Domaine, GpsPoint, Lot, MeasurementPoint, MeasurementQA, Parcelle, SP } from "@/lib/types";
import { StatusBadge } from "./app.index";

export const Route = createFileRoute("/app/parcelles/$id")({
  component: ParcDetail,
  head: () => ({ meta: [{ title: "Détail mesure — AcreMap" }] }),
});

function normalizeQa(
  qa: MeasurementQA | undefined,
  profile: DeviceProfile | undefined,
  trace: GpsPoint[],
  points: MeasurementPoint[]
): MeasurementQA | null {
  if (qa) return qa;
  const accuracies = [...trace, ...points].map((p) => p.accuracy).filter((a) => Number.isFinite(a) && a < 999).sort((a, b) => a - b);
  if (accuracies.length === 0 && !profile) return null;
  const best = profile?.bestAccuracyM ?? accuracies[0] ?? DEFAULT_GPS_CONFIG.maxAcceptableAccuracy;
  const median = profile?.medianAccuracyM ?? accuracies[Math.floor(accuracies.length / 2)] ?? best;
  return {
    acceptedCount: profile?.samplesCount ?? accuracies.length,
    rejectedCount: 0,
    maxAcceptableAccuracyM: DEFAULT_GPS_CONFIG.maxAcceptableAccuracy,
    bestAccuracyM: best,
    medianAccuracyM: median,
    liveAccuracyM: points.at(-1)?.accuracy ?? trace.at(-1)?.accuracy,
    history: [...trace.slice(-24), ...points.slice(-16)].slice(-40).map((p) => ({
      ts: p.ts,
      accuracyM: p.accuracy,
      accepted: p.accuracy <= DEFAULT_GPS_CONFIG.maxAcceptableAccuracy,
    })),
  };
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="p-8 max-w-md mx-auto text-center space-y-3">
      <h1 className="text-xl font-bold text-destructive">Impossible d'afficher la consultation</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Link to="/app/parcelles" className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold">
        Retour aux parcelles
      </Link>
    </div>
  );
}

function EmptyParcelleState({ parc, dom, sp }: { parc?: Parcelle | null; dom?: Domaine | null; sp?: SP | null }) {
  const title = parc ? `${parc.code} — ${parc.ownerName}` : "Mesure introuvable";
  return (
    <div className="p-8 max-w-md mx-auto text-center space-y-3">
      <h1 className="text-xl font-bold">{title}</h1>
      {sp && <p className="text-xs text-muted-foreground">{sp.district} › {sp.region} › {sp.departement} › {sp.name}{dom ? ` › ${dom.name}` : ""}</p>}
      <p className="text-sm text-muted-foreground">Aucun levé terminé n'est encore associé à cette parcelle.</p>
      <div className="flex gap-2 justify-center">
        <Link to="/app/parcelles" className="h-10 px-4 inline-flex items-center rounded-md border text-sm font-medium">Retour</Link>
        {parc && (
          <Link to="/app/measure" search={{ parcelleId: parc.id }} className="h-10 px-4 inline-flex items-center rounded-md bg-primary text-primary-foreground text-sm font-semibold">
            Démarrer le levé
          </Link>
        )}
      </div>
    </div>
  );
}

function ParcDetail() {
  const { id } = Route.useParams();
  const user = useAuth((s) => s.user);
  const nav = useNavigate();
  const [satellite, setSatellite] = useState(true);
  const [showMorc, setShowMorc] = useState(false);
  const [lotHa, setLotHa] = useState(1);
  const [morcAxis, setMorcAxis] = useState<Axis>("horizontal");
  const [partageOn, setPartageOn] = useState(false);
  const [partageAxis, setPartageAxis] = useState<Axis>("horizontal");
  const [pctAC, setPctAC] = useState(50);
  const [partageTarget, setPartageTarget] = useState<"AC" | "PROPRIO" | "TOUT">("TOUT");
  const [voieOn, setVoieOn] = useState(false);
  const [voieAxis, setVoieAxis] = useState<Axis>("horizontal");
  const [voieWidth, setVoieWidth] = useState(4);

  const data = useLiveQuery(async () => {
    if (!isBrowser()) return undefined;
    try {
      const d = db();
      let m = await d.measurements.get(id);
      let parc = m?.parcelleId ? await d.parcelles.get(m.parcelleId) : null;
      if (!m) {
        parc = await d.parcelles.get(id) ?? null;
        const linked = parc ? await d.measurements.where("parcelleId").equals(parc.id).toArray() : [];
        m = linked.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
      }
      if (!m) {
        const dom = parc ? await d.domaines.get(parc.domaineId) : null;
        const sp = dom ? await d.sps.get(dom.spId) : null;
        return { m: null, parc, dom, sp, lots: [], error: null };
      }
      const dom = parc ? await d.domaines.get(parc.domaineId) : null;
      const sp = dom ? await d.sps.get(dom.spId) : null;
      const lots = await d.lots.where("measurementId").equals(m.id).toArray();
      return { m, parc, dom, sp, lots, error: null };
    } catch (e: any) {
      return { m: null, parc: null, dom: null, sp: null, lots: [], error: e?.message ?? "Impossible d'afficher cette mesure." };
    }
  }, [id]);

  const partage = useMemo(() => {
    if (!data?.m || !partageOn || data.m.points.length < 3) return null;
    return partagerParcelle(data.m.points, partageAxis, pctAC);
  }, [data?.m, partageOn, partageAxis, pctAC]);

  // Polygones cibles à morceler après partage
  const morcSources = useMemo(() => {
    if (!data?.m) return [];
    if (!partage) return [data.m.points];
    if (partageTarget === "AC") return partage.partAC;
    if (partageTarget === "PROPRIO") return partage.partProprio;
    return [...partage.partAC, ...partage.partProprio];
  }, [data?.m, partage, partageTarget]);

  // Voie générée (sur l'union ou sur chaque source)
  const voieResult = useMemo(() => {
    if (!data?.m || !voieOn || data.m.points.length < 3) return null;
    return genererVoie(data.m.points, voieAxis, voieWidth);
  }, [data?.m, voieOn, voieAxis, voieWidth]);

  const morcResult = useMemo(() => {
    if (!data?.m || morcSources.length === 0) return null;
    // Si voie active, on morcelle sur le reste de chaque source moins la voie centrale.
    const sources = voieResult ? voieResult.reste : morcSources;
    let allLots: { code: string; polygon: { lat: number; lng: number }[]; areaM2: number }[] = [];
    let total = 0;
    let i = 1;
    for (const src of sources) {
      const r = morcelerStrict(src, lotHa, morcAxis);
      r.lots.forEach((l) => allLots.push({ ...l, code: `H${String(i++).padStart(2, "0")}` }));
      total += r.totalAreaM2;
    }
    return { lots: allLots, totalAreaM2: total };
  }, [data?.m, morcSources, voieResult, lotHa, morcAxis]);


  if (data === undefined) return <div className="p-8 text-center text-muted-foreground">Chargement…</div>;
  const { m, parc, dom, sp, lots } = data;
  if (data.error) return <ErrorState message={data.error} />;
  if (!m) return <EmptyParcelleState parc={parc} dom={dom} sp={sp} />;

  const measuredAreaM2 = polygonAreaM2(m.points);
  const measuredPerimeterM = polygonPerimeterM(m.points);
  const qa = normalizeQa(m.qa, m.deviceProfile, m.trace, m.points);

  const reference = parc && dom && sp
    ? refOfficielle({ spCode: sp.code, domCode: dom.code, parcCode: parc.code })
    : "—";

  const displayLots = showMorc && morcResult
    ? morcResult.lots
    : lots.map((l) => ({ code: l.code, polygon: l.polygon, areaM2: l.areaM2 }));

  async function saveMorc() {
    if (!morcResult || morcResult.lots.length === 0) return;
    const items: Lot[] = morcResult.lots.map((l) => ({
      id: crypto.randomUUID(),
      parcelleId: parc?.id ?? m!.id,
      measurementId: m!.id,
      code: l.code,
      polygon: l.polygon,
      areaM2: l.areaM2,
    }));
    await db().lots.where("measurementId").equals(m!.id).delete();
    await db().lots.bulkPut(items);
    setShowMorc(false);
  }

  async function deleteLots() {
    if (!confirm(`Supprimer les ${lots.length} lots créés ?`)) return;
    await db().lots.where("measurementId").equals(m!.id).delete();
  }

  async function assignLot(lotId: string) {
    const name = prompt("Nom du souscripteur pour ce lot :");
    if (!name) return;
    await db().lots.update(lotId, { assigneeName: name, assignedAt: Date.now() });
  }

  async function validate() {
    if (!hasRole(user, "admin")) return;
    await db().measurements.update(m!.id, { status: "validated", validatedBy: user!.id, validatedAt: Date.now() });
  }

  async function remove() {
    if (!hasRole(user, "admin")) return;
    if (!confirm("Supprimer définitivement cette mesure ?")) return;
    if (!confirm("Confirmer une seconde fois — action irréversible.")) return;
    await db().lots.where("measurementId").equals(m!.id).delete();
    await db().measurements.delete(m!.id);
    nav({ to: "/app/parcelles" });
  }

  function exportAs(kind: "geojson" | "kml" | "csv") {
    const base = parc?.code ?? `mesure-${m!.id.slice(0, 6)}`;
    const p = parc ?? null;
    if (kind === "geojson") downloadBlob(JSON.stringify(toGeoJSON(p, m!, lots), null, 2), `${base}.geojson`, "application/geo+json");
    else if (kind === "kml") downloadBlob(toKML(p, m!, lots), `${base}.kml`, "application/vnd.google-earth.kml+xml");
    else downloadBlob(toCSV(m!), `${base}-points.csv`, "text/csv");
  }

  function exportPdf() {
    const blob = buildGeometrePdf({
      measurement: m!, parcelle: parc ?? null, domaine: dom ?? null, sp: sp ?? null,
      lots, operatorName: user?.fullName ?? "—",
    });
    const base = parc?.code ?? `mesure-${m!.id.slice(0, 6)}`;
    downloadBlob(blob, `${base}-document-travail.pdf`, "application/pdf");
  }

  // Calcul des segments (distance par côté)
  const segments = m.points.map((p, i) => {
    const next = m.points[(i + 1) % m.points.length];
    return { from: i + 1, to: ((i + 1) % m.points.length) + 1, d: haversine(p, next) };
  });

  return (
    <div className="lg:flex lg:h-screen">
      {/* Map */}
      <div className="h-[55vh] lg:h-screen lg:flex-1 relative">
        <MapView
          satellite={satellite}
          perimeter={m.points}
          trace={m.trace}
          lots={displayLots}
        />
        <button onClick={() => setSatellite((s) => !s)}
          className="absolute top-3 right-3 z-[1000] px-3 py-1.5 rounded-md bg-card shadow text-xs font-medium border">
          {satellite ? "Vue carte" : "Vue satellite"}
        </button>
      </div>

      {/* Side panel */}
      <aside className="lg:w-[420px] bg-card lg:border-l overflow-y-auto">
        <div className="p-5 space-y-5">
          <div>
            <Link to="/app/parcelles" className="text-xs text-muted-foreground hover:underline">← Toutes les mesures</Link>
            <div className="flex items-center justify-between mt-1">
              <h1 className="text-xl font-bold">{parc?.code ?? `Mesure ${m.id.slice(0, 6)}`}</h1>
              <StatusBadge status={m.status} />
            </div>
            {parc && (
              <div className="text-sm text-muted-foreground">
                {parc.ownerName}{parc.ownerPhone && ` · ${parc.ownerPhone}`}
              </div>
            )}
            {sp && (
              <div className="text-[11px] text-muted-foreground">
                {sp.district} › {sp.region} › {sp.departement} › {sp.name}
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-2 font-mono bg-muted rounded-md p-2 break-all">
              {reference}
            </div>
            {parc && (parc.ownerPhoto || parc.groupPhoto || parc.parcellePhoto) && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {parc.ownerPhoto && <PhotoThumb src={parc.ownerPhoto} label="Propriétaire" />}
                {parc.groupPhoto && <PhotoThumb src={parc.groupPhoto} label="Groupe" />}
                {parc.parcellePhoto && <PhotoThumb src={parc.parcellePhoto} label="Parcelle" />}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <Stat label="Surface" value={formatArea(measuredAreaM2, m.unit)} />
            <Stat label="Périmètre" value={`${measuredPerimeterM.toFixed(0)} m`} />
            <Stat label="Points" value={String(m.points.length)} />
            <Stat label="Lots créés" value={String(lots.length)} />
          </div>

          {qa && (
            <div className="text-xs bg-accent/5 border border-accent/20 rounded-lg p-3 space-y-2">
              <div className="font-semibold text-accent">Contrôle qualité GPS</div>
              <div className="grid grid-cols-2 gap-2">
                <span>Live: <b>±{qa.liveAccuracyM != null ? qa.liveAccuracyM.toFixed(1) : "—"} m</b></span>
                <span>Seuil: <b>≤{qa.maxAcceptableAccuracyM.toFixed(0)} m</b></span>
                <span>Meilleure: <b>±{qa.bestAccuracyM.toFixed(1)} m</b></span>
                <span>Médiane: <b>±{qa.medianAccuracyM.toFixed(1)} m</b></span>
                <span>Acceptés: <b>{qa.acceptedCount}</b></span>
                <span>Rejetés: <b>{qa.rejectedCount}</b></span>
              </div>
              <div className="flex items-end gap-0.5 h-8 pt-1" aria-label="Historique qualité GPS">
                {qa.history.slice(-40).map((q, i) => {
                  const h = Math.max(8, Math.min(32, 32 - q.accuracyM * 0.8));
                  const cls = !q.accepted ? "bg-destructive" : q.accuracyM <= 5 ? "bg-success" : q.accuracyM <= 10 ? "bg-warn" : "bg-accent";
                  return <div key={`${q.ts}-${i}`} className={`flex-1 rounded-sm ${cls}`} style={{ height: `${h}px` }} title={`±${q.accuracyM.toFixed(1)} m · ${q.accepted ? "accepté" : "rejeté"}`} />;
                })}
              </div>
              <div className="max-h-28 overflow-y-auto border rounded-md bg-background/60">
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-muted"><tr><th className="text-left p-1">Heure</th><th className="text-right p-1">Précision</th><th className="text-left p-1">Décision</th></tr></thead>
                  <tbody>
                    {qa.history.slice(-12).reverse().map((q, i) => (
                      <tr key={`${q.ts}-row-${i}`} className="border-t">
                        <td className="p-1">{new Date(q.ts).toLocaleTimeString("fr-FR")}</td>
                        <td className="p-1 text-right font-mono">±{q.accuracyM.toFixed(1)} m</td>
                        <td className={q.accepted ? "p-1 text-success" : "p-1 text-destructive"}>{q.accepted ? "accepté" : "rejeté"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Morcellement automatique</h3>
            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1">
                Taille lot:
                <select value={lotHa} onChange={(e) => setLotHa(Number(e.target.value))}
                  className="px-2 py-1 rounded border bg-background">
                  <option value={1}>1 ha</option>
                  <option value={0.5}>0,5 ha</option>
                  <option value={2}>2 ha</option>
                </select>
              </label>
              <button onClick={() => setShowMorc((s) => !s)}
                className="ml-auto px-3 py-1.5 rounded-md border text-xs font-medium">
                {showMorc ? "Masquer aperçu" : "Aperçu morcellement"}
              </button>
            </div>
            {showMorc && morcResult && (
              <>
                <div className="text-xs text-muted-foreground">
                  Aperçu : {morcResult.lots.length} lots — {formatArea(morcResult.totalAreaM2)} total
                </div>
                <button onClick={saveMorc} disabled={morcResult.lots.length === 0}
                  className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
                  Valider et créer les {morcResult.lots.length} lots
                </button>
              </>
            )}

            {lots.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted px-2 py-1.5 text-[11px] font-semibold flex items-center justify-between">
                  <span>{lots.length} lots créés</span>
                  <button onClick={deleteLots} className="text-destructive text-[10px] hover:underline">Tout supprimer</button>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-1.5">Code</th>
                        <th className="text-right p-1.5">Surface</th>
                        <th className="text-left p-1.5">Souscripteur</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lots.map((l) => (
                        <tr key={l.id} className="border-t">
                          <td className="p-1.5 font-mono">{l.code}</td>
                          <td className="p-1.5 text-right">{formatArea(l.areaM2)}</td>
                          <td className="p-1.5">
                            <button onClick={() => assignLot(l.id)}
                              className="text-left text-primary hover:underline truncate max-w-[120px]">
                              {l.assigneeName ?? "+ assigner"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Tableau des côtés */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Côtés de la parcelle</h3>
            <div className="max-h-40 overflow-y-auto border rounded-lg">
              <table className="w-full text-[11px]">
                <thead className="bg-muted sticky top-0">
                  <tr><th className="text-left p-1.5">Segment</th><th className="text-right p-1.5">Longueur</th></tr>
                </thead>
                <tbody>
                  {segments.map((s) => (
                    <tr key={`${s.from}-${s.to}`} className="border-t">
                      <td className="p-1.5">P{s.from} → P{s.to}</td>
                      <td className="p-1.5 text-right font-mono">{s.d.toFixed(1)} m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Exports</h3>
            <button onClick={exportPdf}
              className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2">
              📄 Document de travail géomètre (PDF)
            </button>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => exportAs("kml")} className="h-10 rounded-md border text-xs font-medium hover:bg-muted">KML</button>
              <button onClick={() => exportAs("geojson")} className="h-10 rounded-md border text-xs font-medium hover:bg-muted">GeoJSON</button>
              <button onClick={() => exportAs("csv")} className="h-10 rounded-md border text-xs font-medium hover:bg-muted">CSV</button>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Le PDF inclut références AgriCapital, plan schématique, coordonnées GPS, azimuts et longueurs des côtés.
              Les exports DXF/Shapefile arriveront avec la connexion back-end.
            </div>
          </div>

          <div className="space-y-2 pt-3 border-t">
            <h3 className="text-sm font-semibold">Workflow</h3>
            <div className="text-xs text-muted-foreground">Créée le {formatDate(m.createdAt)}</div>
            {m.validatedAt && <div className="text-xs text-success">Validée le {formatDate(m.validatedAt)}</div>}
            {hasRole(user, "admin") && m.status === "submitted" && (
              <button onClick={validate}
                className="w-full h-10 rounded-md bg-success text-white text-sm font-semibold">
                Valider la mesure (admin)
              </button>
            )}
            {hasRole(user, "admin") && (
              <button onClick={remove}
                className="w-full h-10 rounded-md border border-destructive text-destructive text-sm">
                Supprimer
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted rounded-lg p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-bold text-base text-foreground">{value}</div>
    </div>
  );
}

function PhotoThumb({ src, label }: { src: string; label: string }) {
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block">
      <img src={src} alt={label} className="w-full aspect-square object-cover rounded-lg border" />
      <div className="text-[10px] text-muted-foreground text-center mt-1">{label}</div>
    </a>
  );
}

