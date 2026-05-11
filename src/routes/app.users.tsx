import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db, isBrowser } from "@/lib/db";
import { useAuth, hasRole } from "@/lib/auth";
import type { Role, User } from "@/lib/types";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/app/users")({
  component: UsersPage,
  head: () => ({ meta: [{ title: "Utilisateurs — AcreMap" }] }),
});

function UsersPage() {
  const me = useAuth((s) => s.user);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("agent");

  const users = useLiveQuery(async () => {
    if (!isBrowser()) return [];
    return db().users.toArray();
  }, []);

  if (!hasRole(me, "admin")) {
    return <div className="p-8 text-center text-muted-foreground">Réservé à l'administrateur principal.</div>;
  }

  async function create() {
    if (!name.trim() || !username.trim()) return;
    const u: User = { id: crypto.randomUUID(), fullName: name, username, role, mustChangePassword: true, createdAt: Date.now() };
    await db().users.put(u);
    setName(""); setUsername(""); setRole("agent");
  }
  async function remove(id: string) {
    if (confirm("Supprimer ce compte ?")) await db().users.delete(id);
  }

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Utilisateurs</h1>
        <p className="text-sm text-muted-foreground">Aucune inscription publique. Seul l'admin crée les comptes.</p>
      </div>

      <section className="bg-card rounded-xl p-4 shadow-card grid sm:grid-cols-4 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom complet"
          className="h-10 px-3 rounded-md border bg-background sm:col-span-2" />
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Identifiant"
          className="h-10 px-3 rounded-md border bg-background" />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}
          className="h-10 px-3 rounded-md border bg-background">
          <option value="agent">Agent terrain</option>
          <option value="admin">Administrateur</option>
          <option value="viewer">Lecture seule</option>
        </select>
        <button onClick={create} className="h-10 px-4 rounded-md bg-primary text-primary-foreground font-semibold sm:col-span-4">
          + Créer le compte (mot de passe temporaire envoyé)
        </button>
      </section>

      <section className="bg-card rounded-xl shadow-card divide-y">
        {(users ?? []).length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">Aucun compte créé en local.</div>}
        {users?.map((u) => (
          <div key={u.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{u.fullName}</div>
              <div className="text-xs text-muted-foreground">@{u.username} · <span className="capitalize">{u.role}</span> · créé le {formatDate(u.createdAt)}</div>
            </div>
            <button onClick={() => remove(u.id)} className="text-xs text-destructive hover:underline">Supprimer</button>
          </div>
        ))}
      </section>
    </div>
  );
}
