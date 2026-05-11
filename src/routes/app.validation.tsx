import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db, isBrowser } from "@/lib/db";
import { useAuth, hasRole } from "@/lib/auth";
import { formatArea, formatDate } from "@/lib/format";

export const Route = createFileRoute("/app/validation")({
  component: ValidationPage,
  head: () => ({ meta: [{ title: "Validation — AcreMap" }] }),
});

function ValidationPage() {
  const user = useAuth((s) => s.user);
  const queue = useLiveQuery(async () => {
    if (!isBrowser()) return null;
    return db().measurements.where("status").equals("submitted").toArray();
  }, []);

  if (!hasRole(user, "admin")) {
    return <div className="p-8 max-w-md mx-auto text-center text-muted-foreground">Réservé à l'administrateur.</div>;
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">File de validation</h1>
        <p className="text-sm text-muted-foreground">Mesures soumises par les agents en attente de votre validation.</p>
      </div>
      <div className="grid gap-3">
        {queue?.length === 0 && (
          <div className="bg-card rounded-xl p-10 text-center text-sm text-muted-foreground shadow-card">
            Tout est à jour — aucune mesure en attente.
          </div>
        )}
        {queue?.map((m) => (
          <Link key={m.id} to="/app/parcelles/$id" params={{ id: m.id }}
            className="block bg-card rounded-xl p-4 shadow-card hover:shadow-elevated">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">Mesure {m.id.slice(0, 8)}</div>
                <div className="text-xs text-muted-foreground">{formatDate(m.createdAt)} · {m.points.length} points</div>
              </div>
              <div className="text-right">
                <div className="font-bold text-primary">{formatArea(m.areaM2, m.unit)}</div>
                <span className="text-[10px] text-warn">À valider</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
