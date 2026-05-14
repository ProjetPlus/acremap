import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { MapView } from "@/components/MapView";
import { db, isBrowser } from "@/lib/db";
import { useAuth, hasRole } from "@/lib/auth";
import { formatArea, formatDate } from "@/lib/format";
import { morceler } from "@/lib/morcellement";
import { refOfficielle } from "@/lib/ref";
import { downloadBlob, toCSV, toGeoJSON, toKML } from "@/lib/export";
import { buildGeometrePdf } from "@/lib/pdf";
import { haversine } from "@/lib/gps";
import type { Lot } from "@/lib/types";
import { StatusBadge } from "./app.index";

export const Route = createFileRoute("/app/parcelles/$id")({
  component: ParcDetail,
  head: () => ({ meta: [{ title: "Détail mesure — AcreMap" }] }),
});

function ParcDetail() {
  const { id } = Route.useParams();
  const user = useAuth((s) => s.user);
  const nav = useNavigate();
  const [satellite, setSatellite] = useState(true);
  const [showMorc, setShowMorc] = useState(false);
  const [lotHa, setLotHa] = useState(1);

  const data = useLiveQuery(async () => {
    if (!isBrowser()) return null;
    const d = db();
    const m = await d.measurements.get(id);
    if (!m) return null;
    const parc = m.parcelleId ? await d.parcelles.get(m.parcelleId) : null;
    const dom = parc ? await d.domaines.get(parc.domaineId) : null;
    const sp = dom ? await d.sps.get(dom.spId) : null;
    const lots = await d.lots.where("measurementId").equals(id).toArray();
    return { m, parc, dom, sp, lots };
  }, [id]);

  const morcResult = useMemo(() => {
    if (!data?.m || data.m.points.length < 3) return null;
    return morceler(data.m.points, lotHa);
  }, [data?.m, lotHa]);

  if (!data) return <div className="p-8 text-center text-muted-foreground">Chargement…</div>;
  const { m, parc, dom, sp, lots } = data;
  if (!m) return <div className="p-8 text-center">Mesure introuvable. <Link to="/app/parcelles" className="underline">Retour</Link></div>;

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
            <Stat label="Surface" value={formatArea(m.areaM2, m.unit)} />
            <Stat label="Périmètre" value={`${m.perimeterM.toFixed(0)} m`} />
            <Stat label="Points" value={String(m.points.length)} />
            <Stat label="Lots créés" value={String(lots.length)} />
          </div>

          {m.deviceProfile && (
            <div className="text-xs bg-accent/5 border border-accent/20 rounded-lg p-3 space-y-1">
              <div className="font-semibold text-accent">Profil GPS de l'appareil</div>
              <div>Type: <b>{m.deviceProfile.estimatedTier}</b></div>
              <div>Meilleure précision: <b>±{m.deviceProfile.bestAccuracyM.toFixed(1)} m</b></div>
              <div>Précision médiane: <b>±{m.deviceProfile.medianAccuracyM.toFixed(1)} m</b></div>
              <div>Échantillons enregistrés: <b>{m.deviceProfile.samplesCount}</b></div>
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
                  {morcResult.lots.length} lots — {formatArea(morcResult.totalAreaM2)} total
                </div>
                <button onClick={saveMorc}
                  className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-semibold">
                  Valider et créer les lots
                </button>
              </>
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

