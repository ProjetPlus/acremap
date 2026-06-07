import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { db, isBrowser } from "@/lib/db";

export const Route = createFileRoute("/app/debug")({
  component: DebugPage,
  head: () => ({ meta: [{ title: "Diagnostic base de données — AcreMap" }] }),
});

type Counts = {
  users: number; sps: number; domaines: number; parcelles: number;
  measurements: number; lots: number;
};

function DebugPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<string>("");
  const [dbList, setDbList] = useState<string>("");

  async function load() {
    setError(null);
    if (!isBrowser()) return;
    try {
      // Lister toutes les bases IndexedDB de cette origine
      const anyIDB = indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string; version?: number }[]> };
      if (anyIDB.databases) {
        const dbs = await anyIDB.databases();
        setDbList(dbs.map((d) => `${d.name} (v${d.version})`).join(", ") || "(aucune)");
      } else {
        setDbList("(API non supportée par ce navigateur)");
      }
      const d = db();
      await d.open();
      const [users, sps, domaines, parcelles, measurements, lots] = await Promise.all([
        d.users.count(), d.sps.count(), d.domaines.count(),
        d.parcelles.count(), d.measurements.count(), d.lots.count(),
      ]);
      setCounts({ users, sps, domaines, parcelles, measurements, lots });
      const mes = await d.measurements.toArray();
      setRaw(JSON.stringify(mes.slice(0, 20).map((m) => ({
        id: m.id, status: m.status, createdAt: m.createdAt,
        parcelleId: m.parcelleId, areaM2: Math.round(m.areaM2),
        points: m.points?.length ?? 0,
      })), null, 2));
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      setError(`${err.name ?? "Erreur"}: ${err.message ?? String(e)}`);
    }
  }

  useEffect(() => { void load(); }, []);

  async function deleteDb() {
    if (!confirm("⚠️ Supprimer définitivement la base locale acremap ? Toutes les mesures locales seront perdues.")) return;
    try {
      (db() as unknown as { close: () => void }).close();
    } catch { /* noop */ }
    await new Promise<void>((res, rej) => {
      const req = indexedDB.deleteDatabase("acremap");
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
      req.onblocked = () => rej(new Error("Base bloquée par un autre onglet."));
    });
    location.reload();
  }

  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Diagnostic base locale</h1>
      <p className="text-sm text-muted-foreground">
        Utilisez cette page si vos enregistrements ne s'affichent pas. La base est stockée dans
        votre navigateur (IndexedDB) — elle est propre à chaque appareil et chaque URL.
      </p>

      <div className="bg-card rounded-xl p-4 shadow-card space-y-2 text-sm">
        <div><span className="text-muted-foreground">Bases IndexedDB détectées :</span> <code>{dbList || "…"}</code></div>
        {error && (
          <div className="text-destructive bg-destructive/10 rounded-md p-2 text-xs">
            <b>Erreur d'ouverture :</b> {error}
          </div>
        )}
        {counts && (
          <ul className="grid grid-cols-2 gap-2">
            {Object.entries(counts).map(([k, v]) => (
              <li key={k} className="flex justify-between bg-muted/50 rounded px-2 py-1">
                <span className="capitalize">{k}</span><b>{v}</b>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2">
        <button onClick={load} className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm">
          🔄 Recharger
        </button>
        <button onClick={deleteDb} className="px-3 py-2 rounded-md border border-destructive/40 text-destructive text-sm">
          🗑 Réinitialiser la base
        </button>
      </div>

      {raw && (
        <details className="bg-card rounded-xl p-4 shadow-card text-xs">
          <summary className="cursor-pointer font-semibold">20 dernières mesures (brut)</summary>
          <pre className="mt-2 overflow-auto">{raw}</pre>
        </details>
      )}
    </div>
  );
}
