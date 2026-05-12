import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/lib/auth";
import { useNavigate, Outlet } from "@tanstack/react-router";
import { notificationPermission, requestNotificationPermission } from "@/lib/feedback";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

const NAV: { to: string; label: string; short: string; icon: string; admin?: boolean }[] = [
  { to: "/app", label: "Tableau de bord", short: "Accueil", icon: "home" },
  { to: "/app/parcelles", label: "Parcelles & levés", short: "Parcelles", icon: "map" },
  { to: "/app/hierarchie", label: "Hiérarchie", short: "Hiérarchie", icon: "tree" },
  { to: "/app/validation", label: "Validation", short: "Valider", icon: "check", admin: true },
  { to: "/app/users", label: "Utilisateurs", short: "Comptes", icon: "users", admin: true },
];

function AppLayout() {
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [notifPerm, setNotifPerm] = useState<string>("default");

  useEffect(() => { if (!user) nav({ to: "/login" }); }, [user, nav]);

  // Service Worker — désactivé dans les iframes / previews Lovable
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let inIframe = false;
    try { inIframe = window.self !== window.top; } catch { inIframe = true; }
    const isPreview =
      typeof window !== "undefined" &&
      (window.location.hostname.includes("id-preview--") ||
       window.location.hostname.includes("lovableproject.com") ||
       window.location.hostname.includes("lovable.app"));
    if (inIframe || isPreview) {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  useEffect(() => { setNotifPerm(notificationPermission()); }, []);

  if (!user) return null;
  const items = NAV.filter((n) => !n.admin || user.role === "admin");

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-muted/30">
      <aside className="hidden lg:flex w-64 flex-col bg-sidebar text-sidebar-foreground">
        <div className="p-5 border-b border-sidebar-border">
          <Logo className="h-9 w-9" showText />
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {items.map((n) => {
            const active = path === n.to || (n.to !== "/app" && path.startsWith(n.to));
            return (
              <Link key={n.to} to={n.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold"
                         : "hover:bg-sidebar-accent text-sidebar-foreground/85"
                }`}>
                <Icon name={n.icon} />
                <span>{n.label}</span>
              </Link>
            );
          })}
          <Link to="/app/parcelles/new"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm bg-accent/20 text-sidebar-foreground border border-accent/30 mt-3">
            <Icon name="crosshair" /><span className="font-semibold">+ Nouveau levé GPS</span>
          </Link>
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          {notifPerm !== "granted" && notifPerm !== "unsupported" && (
            <button onClick={async () => setNotifPerm(await requestNotificationPermission())}
              className="w-full text-left px-3 py-2 rounded-lg text-xs bg-warn/20 text-sidebar-foreground border border-warn/30">
              🔔 Activer notifications
            </button>
          )}
          <div className="px-3 py-2 text-xs">
            <div className="font-semibold text-sidebar-foreground">{user.fullName}</div>
            <div className="text-sidebar-foreground/60 capitalize">{user.role}</div>
          </div>
          <button onClick={() => { signOut(); nav({ to: "/login" }); }}
            className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-sidebar-accent text-sidebar-foreground/85">
            Déconnexion
          </button>
        </div>
      </aside>

      <header className="lg:hidden flex items-center justify-between p-3 bg-card border-b">
        <Logo className="h-8 w-8" showText />
        <div className="flex items-center gap-2">
          {notifPerm !== "granted" && notifPerm !== "unsupported" && (
            <button onClick={async () => setNotifPerm(await requestNotificationPermission())}
              className="text-xs px-2.5 py-1.5 rounded-md bg-warn/20 text-warn border border-warn/30">🔔</button>
          )}
          <button onClick={() => { signOut(); nav({ to: "/login" }); }}
            className="text-xs px-3 py-1.5 rounded-md border">Sortie</button>
        </div>
      </header>

      <main className="flex-1 min-w-0 pb-24 lg:pb-0">
        <Outlet />
      </main>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-card border-t flex items-stretch justify-around z-30 safe-area-bottom">
        {items.slice(0, 4).map((n) => {
          const active = path === n.to || (n.to !== "/app" && path.startsWith(n.to));
          return (
            <Link key={n.to} to={n.to}
              className={`flex-1 flex flex-col items-center justify-center py-2 text-[10px] gap-0.5 ${
                active ? "text-primary font-semibold" : "text-muted-foreground"
              }`}>
              <Icon name={n.icon} />
              <span className="leading-none">{n.short}</span>
            </Link>
          );
        })}
        <Link to="/app/parcelles/new"
          className="flex-1 flex flex-col items-center justify-center py-2 text-[10px] gap-0.5 bg-primary text-primary-foreground font-semibold">
          <Icon name="crosshair" />
          <span className="leading-none">Nouveau</span>
        </Link>
      </nav>
    </div>
  );
}

function Icon({ name }: { name: string }) {
  const common = "w-5 h-5";
  const stroke = "currentColor";
  switch (name) {
    case "home": return <svg className={common} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2"><path d="M3 12L12 4l9 8" /><path d="M5 10v10h14V10" /></svg>;
    case "crosshair": return <svg className={common} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><circle cx="12" cy="12" r="2" fill={stroke} /></svg>;
    case "map": return <svg className={common} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2"><path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" /></svg>;
    case "tree": return <svg className={common} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2"><path d="M5 6h4M5 12h4M5 18h4M9 6v12M13 6h6M13 12h6M13 18h6" /></svg>;
    case "check": return <svg className={common} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2"><path d="M5 12l5 5L20 7" /></svg>;
    case "users": return <svg className={common} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2"><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5M16 11a3 3 0 100-6M21 20c0-2-2-4-5-4" /></svg>;
    default: return null;
  }
}
