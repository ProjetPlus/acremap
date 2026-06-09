import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "Connexion — AcreMap" }] }),
});

function LoginPage() {
  const navigate = useNavigate();
  const signIn = useAuth((s) => s.signIn);
  const user = useAuth((s) => s.user);
  const hydrated = useAuth((s) => s.hydrated);
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsSignup, setNeedsSignup] = useState(false);
  const [signupName, setSignupName] = useState("");

  // Si déjà connecté → /app
  useEffect(() => {
    if (hydrated && user) {
      if (user.mustChangePassword) navigate({ to: "/app/change-password" });
      else navigate({ to: "/app" });
    }
  }, [hydrated, user, navigate]);

  // Détecte si la base n'a aucun admin → propose le bootstrap (1ère installation)
  useEffect(() => {
    (async () => {
      const { count } = await supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "admin");
      if ((count ?? 0) === 0) setNeedsSignup(true);
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setLoading(true);
    try {
      const me = await signIn(u, p);
      if ((me as any).mustChangePassword) navigate({ to: "/app/change-password" });
      else navigate({ to: "/app" });
    } catch (e: any) {
      setErr(e.message);
    } finally { setLoading(false); }
  }

  async function bootstrapSignup(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: u, password: p,
        options: { emailRedirectTo: window.location.origin, data: { full_name: signupName || u.split("@")[0], username: u.split("@")[0] } }
      });
      if (error) throw error;
      if (!data.session) {
        setErr("Compte créé. Vérifiez votre e-mail pour confirmer, puis connectez-vous.");
        setNeedsSignup(false);
        return;
      }
      // Auto-promote as first admin
      const { bootstrapFirstAdmin } = await import("@/lib/admin-users.functions");
      try { await bootstrapFirstAdmin(); } catch { /* ignore */ }
      navigate({ to: "/app" });
    } catch (e: any) {
      setErr(e.message);
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[40%_60%]">
      <aside className="hidden lg:flex flex-col justify-between bg-sidebar text-sidebar-foreground p-10 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06] pointer-events-none"
             style={{ backgroundImage: "radial-gradient(circle at 30% 20%, white 1px, transparent 1px), radial-gradient(circle at 70% 60%, white 1px, transparent 1px)", backgroundSize: "80px 80px" }} />
        <div className="relative">
          <Logo className="h-16 w-16" />
          <h1 className="mt-8 text-4xl font-bold leading-tight">Mesurer.<br/>Morceler.<br/>Référencer.</h1>
          <p className="mt-6 text-sm text-sidebar-foreground/70 max-w-sm">
            Outil de terrain AgriCapital pour le levé GPS, le morcellement automatique en lots d'1 ha
            et le référencement officiel des plantations.
          </p>
        </div>
        <div className="relative text-xs text-sidebar-foreground/50">
          AcreMap V1 — AgriCapital SARL · Daloa, Côte d'Ivoire
        </div>
      </aside>

      <main className="flex items-center justify-center p-6 bg-background">
        <form onSubmit={needsSignup ? bootstrapSignup : submit} className="w-full max-w-sm space-y-6">
          <div className="lg:hidden flex flex-col items-center text-center">
            <Logo className="h-20 w-20" />
            <div className="mt-3 text-xl font-bold text-primary">AcreMap</div>
            <p className="text-xs text-muted-foreground">Mesurer. Morceler. Référencer.</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold">{needsSignup ? "Première installation" : "Connexion"}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {needsSignup
                ? "Aucun administrateur n'existe encore. Créez le premier compte administrateur."
                : "Accédez à votre espace de travail terrain."}
            </p>
          </div>

          <div className="space-y-3">
            {needsSignup && (
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Nom complet</span>
                <input value={signupName} onChange={(e) => setSignupName(e.target.value)} required
                  className="mt-1 w-full h-11 px-3 rounded-lg border bg-card" />
              </label>
            )}
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Adresse e-mail</span>
              <input value={u} onChange={(e) => setU(e.target.value)} type="email" required autoComplete="email"
                className="mt-1 w-full h-11 px-3 rounded-lg border border-input bg-card focus:outline-none focus:ring-2 focus:ring-ring" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Mot de passe</span>
              <input type="password" value={p} onChange={(e) => setP(e.target.value)} required autoComplete={needsSignup ? "new-password" : "current-password"}
                className="mt-1 w-full h-11 px-3 rounded-lg border border-input bg-card focus:outline-none focus:ring-2 focus:ring-ring" />
            </label>
          </div>

          {err && <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{err}</div>}

          <button disabled={loading} type="submit"
            className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-secondary transition-colors disabled:opacity-60">
            {loading ? "Veuillez patienter…" : needsSignup ? "Créer le compte administrateur" : "Se connecter"}
          </button>

          <div className="text-center text-xs text-muted-foreground">
            Mot de passe oublié ? Contactez l'administrateur principal.
          </div>
        </form>
      </main>
    </div>
  );
}
