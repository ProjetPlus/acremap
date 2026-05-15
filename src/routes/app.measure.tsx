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
import {
  MapPin, Pause, Play, Undo2, Save, Send, Settings2, Layers, X,
  ChevronDown, ChevronUp, Crosshair, AlertTriangle, Activity,
} from "lucide-react";

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
  const [rejectedCount, setRejectedCount] = useState(0);
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [qaHistory, setQaHistory] = useState<{ ts: number; acc: number; ok: boolean }[]>([]);
  const [capturing, setCapturing] = useState<{ n: number; target: number; acc: number } | null>(null);
  const [autoMark100, setAutoMark100] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(true);
  const [qaOpen, setQaOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const lastAutoRef = useRef<GpsPoint | null>(null);
  const watchRef = useRef<{ stop: () => void } | null>(null);
  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    if (!running) return;
    setError(null);
    const handle = startWatch((raw, filtered) => {
      setCurrent(raw);
      setFilteredCur(filtered);
      const accepted = raw.accuracy <= DEFAULT_GPS_CONFIG.maxAcceptableAccuracy;
      if (accepted) {
        if (raw.accuracy < bestAcc) setBestAcc(raw.accuracy);
        setAccSamples((s) => [...s.slice(-199), raw.accuracy]);
        setAcceptedCount((c) => c + 1);
      } else {
        setRejectedCount((c) => c + 1);
      }
      setQaHistory((h) => [...h.slice(-29), { ts: raw.ts, acc: raw.accuracy, ok: accepted }]);
      if (pausedRef.current) return;
      setTrace((tr) => {
        const last = tr[tr.length - 1];
        if (!accepted) return tr;
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
  }
  function togglePause() {
    setPaused((p) => {
      const next = !p;
      if (next) notify("Mesure en pause", "La trace est suspendue.", { tag: "pause" });
      else { lastAutoRef.current = filteredCur ?? lastAutoRef.current; notify("Mesure reprise", "Continuez votre tracé.", { tag: "resume" }); }
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
      points, trace,
      areaM2: polygonAreaM2(points),
      perimeterM: polygonPerimeterM(points),
      unit,
      deviceProfile: {
        userAgent: navigator.userAgent, platform: navigator.platform,
        estimatedTier: estimateDeviceTier(bestAcc),
        bestAccuracyM: bestAcc, medianAccuracyM: median,
        samplesCount: acceptedCount + rejectedCount,
      },
      qa: {
        acceptedCount, rejectedCount,
        maxAcceptableAccuracyM: DEFAULT_GPS_CONFIG.maxAcceptableAccuracy,
        bestAccuracyM: bestAcc, medianAccuracyM: median,
        liveAccuracyM: filteredCur?.accuracy,
        history: qaHistory.map((q) => ({ ts: q.ts, accuracyM: q.acc, accepted: q.ok })),
      },
    };
    await db().measurements.put(m);
    feedbackSuccess();
    if (submit) await notify("Mesure soumise", `Levé envoyé (${formatArea(m.areaM2, m.unit)}).`, { tag: "submit" });
    navigate({ to: "/app/parcelles/$id", params: { id: m.id } });
  }

  const area = polygonAreaM2(points);
  const perim = polygonPerimeterM(points);
  const accClass = filteredCur ? classifyAccuracy(filteredCur.accuracy) : "bad";
  const guideTo = points.length >= 3 ? points[0] : null;
  const sortedAcc = [...accSamples].sort((a, b) => a - b);
  const medianAcc = sortedAcc.length ? sortedAcc[Math.floor(sortedAcc.length / 2)] : null;
  const totalSamples = acceptedCount + rejectedCount;
  const acceptRate = totalSamples > 0 ? Math.round((acceptedCount / totalSamples) * 100) : 0;
  const qaReady = acceptedCount >= 30 && bestAcc <= 12 && (medianAcc ?? 99) <= 15;

  const accDot = accClass === "good" ? "bg-success" : accClass === "ok" ? "bg-warn" : "bg-destructive";
  const accBg = accClass === "good" ? "bg-success/90" : accClass === "ok" ? "bg-warn/90" : "bg-destructive/90";

  return (
    <div className="fixed inset-0 lg:relative lg:h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* CARTE PLEIN ÉCRAN */}
      <div className="absolute inset-0">
        <MapView
          satellite={satellite}
          current={filteredCur}
          currentAccuracy={filteredCur?.accuracy}
          perimeter={points}
          trace={trace}
          guideTo={guideTo}
          guideColor="orange"
        />
      </div>

      {/* TOP BAR FLOTTANTE — compacte */}
      <div className="absolute top-2 left-2 right-2 z-[500] flex items-start gap-2 pointer-events-none">
        <div className={`pointer-events-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-white text-xs font-bold shadow-elevated ${accBg}`}>
          <span className={`w-2 h-2 rounded-full bg-white animate-pulse`} />
          ±{filteredCur ? filteredCur.accuracy.toFixed(1) : "—"}m
        </div>
        {linkedParcelle ? (
          <div className="pointer-events-auto flex-1 min-w-0 px-2.5 py-1.5 rounded-full bg-card/95 backdrop-blur shadow-elevated text-[11px] truncate">
            <b className="text-primary">{linkedParcelle.code}</b> · {linkedParcelle.ownerName}
          </div>
        ) : (
          <Link to="/app/parcelles/new" className="pointer-events-auto flex-1 px-2.5 py-1.5 rounded-full bg-warn/95 text-white text-[11px] font-semibold shadow-elevated truncate">
            <AlertTriangle className="inline w-3 h-3 mr-1" />Créer la parcelle
          </Link>
        )}
        <Link to="/app" className="pointer-events-auto p-2 rounded-full bg-card/95 backdrop-blur shadow-elevated">
          <X className="w-4 h-4" />
        </Link>
      </div>

      {/* BANDEAU PAUSE */}
      {paused && running && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[500] px-3 py-1.5 rounded-full bg-warn text-white text-xs font-bold shadow-elevated animate-pulse">
          ⏸ PAUSE
        </div>
      )}

      {/* BARRE STATS FLOTTANTE — repliable */}
      <div className="absolute top-12 right-2 z-[500] w-44">
        <button
          onClick={() => setStatsOpen((s) => !s)}
          className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-t-lg bg-card/95 backdrop-blur shadow-elevated text-[11px] font-semibold border-b"
        >
          <span className="flex items-center gap-1.5"><Activity className="w-3 h-3" />Statistiques</span>
          {statsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {statsOpen && (
          <div className="bg-card/95 backdrop-blur shadow-elevated rounded-b-lg p-2 space-y-1 text-[11px]">
            <Row label="Points" value={String(points.length)} />
            <Row label="Périm." value={formatDistance(perim)} />
            <Row label="Surface" value={formatArea(area, unit)} bold />
            <Row label="Méd." value={medianAcc != null ? `±${medianAcc.toFixed(1)}m` : "—"} />
            <Row label="Best" value={bestAcc < 999 ? `±${bestAcc.toFixed(1)}m` : "—"} />
            {points.length > 0 && (
              <Row label="Auto dans" value={`${Math.max(0, DEFAULT_GPS_CONFIG.autoMarkEveryMeters - distanceFromLast).toFixed(0)}m`} />
            )}
          </div>
        )}
      </div>

      {/* OPTIONS RAPIDES — bouton flottant gauche */}
      <div className="absolute top-12 left-2 z-[500] flex flex-col gap-2">
        <button
          onClick={() => setSatellite((s) => !s)}
          className="p-2 rounded-full bg-card/95 backdrop-blur shadow-elevated"
          title={satellite ? "Vue carte" : "Vue satellite"}
        >
          <Layers className="w-4 h-4" />
        </button>
        <button
          onClick={() => setOptionsOpen(true)}
          className="p-2 rounded-full bg-card/95 backdrop-blur shadow-elevated"
          title="Options"
        >
          <Settings2 className="w-4 h-4" />
        </button>
        {running && (
          <button
            onClick={() => setQaOpen((q) => !q)}
            className={`p-2 rounded-full shadow-elevated ${qaReady ? "bg-success text-white" : "bg-warn text-white"}`}
            title="Contrôle qualité GPS"
          >
            <Crosshair className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* PANNEAU QA FLOTTANT */}
      {qaOpen && running && (
        <div className="absolute top-32 left-2 z-[500] w-60 bg-card/95 backdrop-blur shadow-elevated rounded-lg p-2.5 text-[11px]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-bold">{qaReady ? "✓ Qualité validée" : "◌ QA en cours"}</span>
            <button onClick={() => setQaOpen(false)}><X className="w-3 h-3" /></button>
          </div>
          <div className="text-muted-foreground mb-1">{acceptedCount} acceptés / {rejectedCount} rejetés ({acceptRate}%)</div>
          <div className="flex items-end gap-0.5 h-8">
            {qaHistory.slice(-30).map((q, i) => {
              const h = Math.max(8, Math.min(32, 32 - q.acc * 0.8));
              const cls = !q.ok ? "bg-destructive" : q.acc <= 5 ? "bg-success" : q.acc <= 10 ? "bg-warn" : "bg-orange-500";
              return <div key={i} className={`flex-1 rounded-sm ${cls}`} style={{ height: `${h}px` }} />;
            })}
            {qaHistory.length === 0 && <span className="text-[10px] text-muted-foreground">En attente…</span>}
          </div>
          <div className="mt-1.5 text-[10px] text-muted-foreground">
            Seuil ≤{DEFAULT_GPS_CONFIG.maxAcceptableAccuracy}m · profil {estimateDeviceTier(bestAcc)}
          </div>
        </div>
      )}

      {/* DOCK BAS — actions principales */}
      <div className="absolute bottom-2 left-2 right-2 z-[500] space-y-2">
        {error && (
          <div className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs text-center shadow-elevated">
            {error}
          </div>
        )}
        <div className="flex gap-1.5 items-stretch">
          <button
            onClick={markPoint}
            disabled={!running || !!capturing || paused}
            className="flex-1 h-14 rounded-2xl bg-accent text-accent-foreground font-bold shadow-elevated disabled:opacity-40 flex flex-col items-center justify-center gap-0.5"
          >
            <MapPin className="w-5 h-5" />
            <span className="text-[11px] leading-none">Marquer</span>
          </button>
          {running && (
            <button
              onClick={togglePause}
              className={`h-14 w-14 rounded-2xl shadow-elevated font-bold flex flex-col items-center justify-center gap-0.5 ${
                paused ? "bg-success text-white" : "bg-warn text-white"
              }`}
            >
              {paused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
              <span className="text-[10px] leading-none">{paused ? "Reprendre" : "Pause"}</span>
            </button>
          )}
          <button
            onClick={undo}
            disabled={points.length === 0}
            className="h-14 w-14 rounded-2xl bg-card shadow-elevated disabled:opacity-30 flex items-center justify-center"
          >
            <Undo2 className="w-5 h-5" />
          </button>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => save(false)}
            disabled={points.length < 3}
            className="flex-1 h-10 rounded-xl bg-card/95 backdrop-blur shadow-elevated text-xs font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />Brouillon
          </button>
          <button
            onClick={() => {
              if (!qaReady && !confirm("Qualité GPS faible. Soumettre quand même ?")) return;
              save(true);
            }}
            disabled={points.length < 3}
            className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground font-semibold text-xs shadow-elevated disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />Soumettre
          </button>
        </div>
      </div>

      {/* OVERLAY DÉMARRAGE */}
      {!running && (
        <div className="absolute inset-0 bg-background/85 backdrop-blur-sm flex items-center justify-center p-6 z-[1000]">
          <div className="bg-card rounded-2xl p-6 max-w-md text-center shadow-elevated">
            <h2 className="text-xl font-bold">Démarrer la mesure</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Positionnez-vous au point de départ puis marchez autour de la parcelle.
              Auto-marquage tous les 100&nbsp;m.
            </p>
            <div className="text-xs text-warn bg-warn/10 rounded-md p-2 mt-3">
              Bornage légal réalisé par un géomètre assermenté.
            </div>
            <button
              onClick={startGps}
              className="mt-5 w-full h-12 bg-primary text-primary-foreground rounded-lg font-semibold"
            >
              Activer GPS, son & notifications
            </button>
          </div>
        </div>
      )}

      {/* OVERLAY CAPTURE STATIQUE */}
      {capturing && (
        <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-[1000]">
          <div className="bg-card p-6 rounded-2xl max-w-xs text-center shadow-elevated">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Capture statique</div>
            <div className="text-3xl font-bold text-primary mt-2">{capturing.n} / {capturing.target}</div>
            <div className="text-xs text-muted-foreground mt-1">±{capturing.acc.toFixed(1)} m</div>
            <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${(capturing.n / capturing.target) * 100}%` }} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">Restez immobile.</p>
          </div>
        </div>
      )}

      {/* DRAWER OPTIONS */}
      {optionsOpen && (
        <div className="absolute inset-0 z-[1000]" onClick={() => setOptionsOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute bottom-0 left-0 right-0 bg-card rounded-t-2xl p-4 space-y-3 shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Options de levée</h3>
              <button onClick={() => setOptionsOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <label className="flex items-center justify-between text-sm">
              <span>Marquage auto tous les 100&nbsp;m</span>
              <input type="checkbox" checked={autoMark100} onChange={(e) => setAutoMark100(e.target.checked)} className="w-5 h-5" />
            </label>
            <label className="flex items-center justify-between text-sm">
              <span>Vue satellite</span>
              <input type="checkbox" checked={satellite} onChange={(e) => setSatellite(e.target.checked)} className="w-5 h-5" />
            </label>
            <label className="flex items-center justify-between text-sm">
              <span>Unité de surface</span>
              <select value={unit} onChange={(e) => setUnit(e.target.value as any)} className="px-2 py-1 rounded border bg-background text-sm">
                <option value="ha">hectares</option>
                <option value="m2">mètres²</option>
                <option value="km2">km²</option>
              </select>
            </label>
            <div className="text-[10px] text-muted-foreground pt-2 border-t">
              Profil&nbsp;: <b>{estimateDeviceTier(bestAcc)}</b> · Échantillons&nbsp;: {totalSamples} · Précision filtrée&nbsp;: ±{filteredCur ? filteredCur.accuracy.toFixed(1) : "—"}&nbsp;m
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? "font-bold text-primary" : "font-semibold"}>{value}</span>
    </div>
  );
}
