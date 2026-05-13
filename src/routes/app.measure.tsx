import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { z } from "zod";
import { MapView } from "@/components/MapView";
import {
  DEFAULT_GPS_CONFIG, captureStaticPoint, classifyAccuracy, estimateDeviceTier,
  haversine, polygonAreaM2, polygonPerimeterM, startWatch,
} from "@/lib/gps";
import { db, isBrowser } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { formatArea, formatDistance } from "@/lib/format";
import { feedbackError, feedbackMark, feedbackSuccess, unlockAudio, notify, requestNotificationPermission } from "@/lib/feedback";
import type { GpsPoint, Measurement, MeasurementPoint } from "@/lib/types";

const searchSchema = z.object({ parcelleId: z.string().optional() });

export const Route = createFileRoute("/app/measure")({
  component: MeasurePage,
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({ meta: [{ title: "Mesure GPS terrain — AcreMap" }] }),
});

function MeasurePage() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const { parcelleId } = Route.useSearch();

  const linkedParcelle = useLiveQuery(async () => {
    if (!isBrowser() || !parcelleId) return null;
    return db().parcelles.get(parcelleId);
  }, [parcelleId]);

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [satellite, setSatellite] = useState(true);
  const [unit, setUnit] = useState<"ha" | "m2" | "km2">("ha");
  const [current, setCurrent] = useState<GpsPoint | null>(null);
  const [filteredCur, setFilteredCur] = useState<GpsPoint | null>(null);
  const [trace, setTrace] = useState<GpsPoint[]>([]);
  const [points, setPoints] = useState<MeasurementPoint[]>([]);
  const [distanceFromLast, setDistanceFromLast] = useState(0);
  const [bestAcc, setBestAcc] = useState<number>(999);
  const [accSamples, setAccSamples] = useState<number[]>([]);
  const [capturing, setCapturing] = useState<{ n: number; target: number; acc: number } | null>(null);
  const [autoMark100, setAutoMark100] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [pausedMs, setPausedMs] = useState(0);
  const lastAutoRef = useRef<GpsPoint | null>(null);
  const watchRef = useRef<{ stop: () => void } | null>(null);
  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // Démarre le GPS
  useEffect(() => {
    if (!running) return;
    setError(null);
    const handle = startWatch((raw, filtered) => {
      // En pause : on continue à afficher la position courante (pour montrer que GPS est vivant),
      // mais on n'enregistre rien dans la trace ni dans les points auto-marqués.
      setCurrent(raw);
      setFilteredCur(filtered);
      if (raw.accuracy < bestAcc) setBestAcc(raw.accuracy);
      setAccSamples((s) => [...s.slice(-99), raw.accuracy]);
      if (pausedRef.current) return;
      setTrace((tr) => {
        const last = tr[tr.length - 1];
        if (raw.accuracy > 30) return tr;
        if (last && haversine(last, filtered) < 1) return tr;
        return [...tr, filtered];
      });
      setPoints((pts) => {
        if (pts.length === 0) return pts;
        const last = pts[pts.length - 1];
        const d = haversine(last, filtered);
        setDistanceFromLast(d);
        if (autoMark100 && d >= DEFAULT_GPS_CONFIG.autoMarkEveryMeters &&
            (!lastAutoRef.current || haversine(lastAutoRef.current, filtered) >= DEFAULT_GPS_CONFIG.autoMarkEveryMeters)) {
          lastAutoRef.current = filtered;
          feedbackMark();
          notify("Point auto-marqué", `Point ${pts.length + 1} enregistré à 100 m du précédent.`, { tag: "auto-mark" });
          const next: MeasurementPoint = {
            index: pts.length + 1, samples: 1, auto: true,
            lat: filtered.lat, lng: filtered.lng, accuracy: filtered.accuracy, ts: Date.now(),
          };
          return [...pts, next];
        }
        return pts;
      });
    });
    watchRef.current = handle;
    return () => { handle.stop(); watchRef.current = null; };
  }, [running, autoMark100]);

  async function startGps() {
    await unlockAudio();
    await requestNotificationPermission();
    setRunning(true);
    setStartedAt(Date.now());
  }
  function togglePause() {
    setPaused((p) => {
      const next = !p;
      if (next) {
        // entrée en pause
        (window as any).__acrePauseStart = Date.now();
        notify("Mesure en pause", "La trace et les marquages auto sont suspendus. Reprenez quand vous voulez.", { tag: "pause" });
      } else {
        const ps = (window as any).__acrePauseStart as number | undefined;
        if (ps) setPausedMs((m) => m + (Date.now() - ps));
        // Réinitialise lastAuto pour ne pas auto-marquer immédiatement après reprise
        lastAutoRef.current = filteredCur ?? lastAutoRef.current;
        notify("Mesure reprise", "Continuez votre tracé.", { tag: "resume" });
      }
      return next;
    });
  }

  async function markPoint() {
    setError(null);
    setCapturing({ n: 0, target: DEFAULT_GPS_CONFIG.staticSamples, acc: 999 });
    try {
      const p = await captureStaticPoint(DEFAULT_GPS_CONFIG, (n, target, acc) => {
        setCapturing({ n, target, acc });
      });
      p.index = points.length + 1;
      setPoints((s) => [...s, p]);
      lastAutoRef.current = { lat: p.lat, lng: p.lng, accuracy: p.accuracy, ts: p.ts };
      feedbackMark();
    } catch (e: any) {
      feedbackError();
      setError(e.message ?? "Erreur de capture");
    } finally {
      setCapturing(null);
    }
  }

  function undo() {
    setPoints((s) => s.slice(0, -1));
    lastAutoRef.current = null;
  }

  async function save(submit: boolean) {
    if (!user) return;
    if (points.length < 3) { setError("Au moins 3 points sont nécessaires."); return; }
    if (!isBrowser()) return;
    const accVals = accSamples.filter((a) => a < 999).sort((a, b) => a - b);
    const median = accVals[Math.floor(accVals.length / 2)] ?? bestAcc;
    const m: Measurement = {
      id: crypto.randomUUID(),
      parcelleId: parcelleId || undefined,
      createdBy: user.id,
      createdAt: Date.now(),
      status: submit ? "submitted" : "draft",
      points,
      trace,
      areaM2: polygonAreaM2(points),
      perimeterM: polygonPerimeterM(points),
      unit,
      deviceProfile: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        estimatedTier: estimateDeviceTier(bestAcc),
        bestAccuracyM: bestAcc,
        medianAccuracyM: median,
        samplesCount: trace.length,
      },
    };
    await db().measurements.put(m);
    feedbackSuccess();
    if (submit) await notify("Mesure soumise", `Levé envoyé à l'admin pour validation (${formatArea(m.areaM2, m.unit)}).`, { tag: "submit" });
    navigate({ to: "/app/parcelles/$id", params: { id: m.id } });
  }

  const area = polygonAreaM2(points);
  const perim = polygonPerimeterM(points);
  const totalDistance = trace.reduce((acc, p, i) => i === 0 ? 0 : acc + haversine(trace[i - 1], p), 0);
  const accClass = filteredCur ? classifyAccuracy(filteredCur.accuracy) : "bad";
  const guideColor: "red" | "orange" = points.length === 3 ? "red" : "orange";
  const guideTo = points.length >= 3 ? points[0] : null;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] lg:h-screen">
      {/* Bandeau parcelle liée */}
      {linkedParcelle && (
        <div className="px-3 py-2 bg-primary/10 border-b text-xs flex items-center gap-2">
          <span className="font-semibold text-primary">Parcelle liée :</span>
          <span className="truncate"><b>{linkedParcelle.code}</b> · {linkedParcelle.ownerName}</span>
          <Link to="/app/parcelles/new" className="ml-auto text-[10px] underline text-muted-foreground">Changer</Link>
        </div>
      )}
      {!linkedParcelle && (
        <div className="px-3 py-2 bg-warn/10 border-b text-xs flex items-center gap-2">
          <span className="text-warn font-semibold">Aucune parcelle sélectionnée.</span>
          <Link to="/app/parcelles/new" className="ml-auto px-2 py-1 rounded bg-warn text-white text-[10px] font-semibold">Créer la parcelle d'abord</Link>
        </div>
      )}

      {/* Top status bar */}
      <div className="px-3 py-2 bg-card border-b flex items-center gap-2 text-xs flex-wrap">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold
          ${accClass === "good" ? "bg-success/15 text-success" :
            accClass === "ok" ? "bg-warn/15 text-warn" : "bg-destructive/15 text-destructive"}`}>
          <span className={`w-2 h-2 rounded-full ${accClass === "good" ? "bg-success" : accClass === "ok" ? "bg-warn" : "bg-destructive"}`} />
          ±{filteredCur ? filteredCur.accuracy.toFixed(1) : "—"} m
        </span>
        <span className="text-muted-foreground">Profil: <b className="text-foreground">{estimateDeviceTier(bestAcc)}</b></span>
        <span className="text-muted-foreground">Best: <b className="text-foreground">±{bestAcc < 999 ? bestAcc.toFixed(1) : "—"} m</b></span>
        <span className="text-muted-foreground">Distance: <b className="text-foreground">{formatDistance(totalDistance)}</b></span>
        <button onClick={() => setSatellite((s) => !s)} className="ml-auto px-3 py-1 rounded-md border text-xs">
          {satellite ? "Vue carte" : "Vue satellite"}
        </button>
      </div>

      <div className="flex-1 relative">
        <MapView satellite={satellite} current={filteredCur} currentAccuracy={filteredCur?.accuracy}
          perimeter={points} trace={trace} guideTo={guideTo} guideColor={guideColor} />
        {paused && running && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 rounded-full bg-warn text-white text-xs font-semibold shadow-elevated animate-pulse">
            ⏸ Pause — déplacez-vous librement, rien n'est enregistré
          </div>
        )}
        {!running && (
          <div className="absolute inset-0 bg-background/85 backdrop-blur-sm flex items-center justify-center p-6 z-10">
            <div className="bg-card rounded-2xl p-6 max-w-md text-center shadow-elevated">
              <h2 className="text-xl font-bold">Démarrer la mesure</h2>
              <p className="text-sm text-muted-foreground mt-2">
                Positionnez-vous au point de départ (Point 1) puis marchez autour de la parcelle.
                Bip puissant + vibration à chaque point auto-marqué (tous les 100 m).
              </p>
              <div className="text-xs text-warn bg-warn/10 rounded-md p-2 mt-3">
                AcreMap utilise le GPS réel du téléphone. Le bornage légal reste réalisé par un géomètre.
              </div>
              <button onClick={startGps}
                className="mt-5 w-full h-12 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-secondary">
                Activer GPS, son & notifications
              </button>
            </div>
          </div>
        )}
        {capturing && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-20">
            <div className="bg-card p-6 rounded-2xl max-w-xs text-center shadow-elevated">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Capture statique</div>
              <div className="text-3xl font-bold text-primary mt-2">{capturing.n} / {capturing.target}</div>
              <div className="text-xs text-muted-foreground mt-1">échantillons GPS · ±{capturing.acc.toFixed(1)} m</div>
              <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${(capturing.n / capturing.target) * 100}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-3">Restez immobile.</p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-card border-t p-3 lg:p-4 space-y-3">
        {error && <div className="text-xs text-destructive bg-destructive/10 px-3 py-1.5 rounded-md">{error}</div>}

        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric label="Points" value={String(points.length)} />
          <Metric label="Périmètre" value={formatDistance(perim)} />
          <Metric label="Surface" value={formatArea(area, unit)} />
        </div>

        {points.length > 0 && (
          <div className="text-[11px] text-muted-foreground text-center">
            Distance depuis Point {points.length} : <b className="text-foreground">{formatDistance(distanceFromLast)}</b>
            {autoMark100 && distanceFromLast < DEFAULT_GPS_CONFIG.autoMarkEveryMeters && (
              <> · prochain auto-marquage dans {Math.max(0, DEFAULT_GPS_CONFIG.autoMarkEveryMeters - distanceFromLast).toFixed(0)} m</>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={markPoint} disabled={!running || !!capturing || paused}
            className="flex-1 h-12 rounded-lg bg-accent text-accent-foreground font-semibold disabled:opacity-50">
            + Marquer un point
          </button>
          {running && (
            <button onClick={togglePause}
              title={paused ? "Reprendre la mesure" : "Mettre en pause"}
              className={`h-12 px-4 rounded-lg font-semibold ${
                paused ? "bg-success text-white" : "bg-warn text-white"
              }`}>
              {paused ? "▶ Reprendre" : "⏸ Pause"}
            </button>
          )}
          <button onClick={undo} disabled={points.length === 0}
            className="h-12 px-4 rounded-lg border font-medium disabled:opacity-40">↶</button>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={autoMark100} onChange={(e) => setAutoMark100(e.target.checked)} />
            Marquage auto 100 m
          </label>
          <select value={unit} onChange={(e) => setUnit(e.target.value as any)}
            className="ml-auto px-2 py-1 rounded border bg-background">
            <option value="ha">hectares</option>
            <option value="m2">mètres²</option>
            <option value="km2">km²</option>
          </select>
        </div>

        <div className="flex gap-2">
          <button onClick={() => save(false)} disabled={points.length < 3}
            className="flex-1 h-11 rounded-lg border font-medium disabled:opacity-40">
            Sauver brouillon
          </button>
          <button onClick={() => save(true)} disabled={points.length < 3}
            className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-50">
            Soumettre validation
          </button>
        </div>
        <p className="text-[10px] text-center text-muted-foreground">
          Précision actuelle : ±{filteredCur ? filteredCur.accuracy.toFixed(1) : "—"} m. Bornage définitif par géomètre.
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded-lg bg-muted">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-bold text-base text-primary">{value}</div>
    </div>
  );
}
