import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db, isBrowser } from "@/lib/db";
import { formatArea, formatDate } from "@/lib/format";
import { StatusBadge } from "./app.index";

export const Route = createFileRoute("/app/parcelles/")({
  component: ParcellesList,
  head: () => ({ meta: [{ title: "Parcelles & mesures — AcreMap" }] }),
});

function ParcellesList() {
  const data = useLiveQuery(async () => {
    if (!isBrowser()) return null;
    const d = db();
    const [mes, parcs] = await Promise.all([d.measurements.toArray(), d.parcelles.toArray()]);
    return { mes: mes.sort((a, b) => b.createdAt - a.createdAt), parcs };
  }, []);

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Parcelles & Mesures</h1>
          <p className="text-sm text-muted-foreground">Toutes les mesures enregistrées sont visibles par l'organisation.</p>
        </div>
        <Link to="/app/measure" className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold">
          + Nouvelle mesure
        </Link>
      </div>

      <div className="grid gap-3">
        {data?.mes.length === 0 && (
          <div className="bg-card rounded-xl p-10 text-center text-sm text-muted-foreground shadow-card">
            Aucune mesure pour le moment.
          </div>
        )}
        {data?.mes.map((m) => {
          const parc = data.parcs.find((p) => p.id === m.parcelleId);
          return (
            <Link key={m.id} to="/app/parcelles/$id" params={{ id: m.id }}
              className="block bg-card rounded-xl p-4 shadow-card hover:shadow-elevated transition-shadow">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{parc?.code ?? `Mesure ${m.id.slice(0, 6)}`}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {parc ? `${parc.ownerName}` : "Sans parcelle liée"} · {formatDate(m.createdAt)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {m.points.length} points · périmètre {(m.perimeterM).toFixed(0)} m
                    {m.deviceProfile && ` · GPS ${m.deviceProfile.estimatedTier} (best ±${m.deviceProfile.bestAccuracyM.toFixed(1)} m)`}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-primary">{formatArea(m.areaM2, m.unit)}</div>
                  <div className="mt-1"><StatusBadge status={m.status} /></div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
