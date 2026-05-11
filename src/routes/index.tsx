import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem("acremap-auth");
    const hasUser = raw && JSON.parse(raw)?.state?.user;
    throw redirect({ to: hasUser ? "/app" : "/login" });
  },
  component: () => null,
});
