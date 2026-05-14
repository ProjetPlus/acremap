// Mock auth store (front-only). Real auth via Supabase plugged later.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Role, User } from "./types";

interface AuthState {
  user: User | null;
  hydrated: boolean;
  signIn: (username: string, password: string) => Promise<User>;
  signOut: () => void;
}

const SEED: Array<User & { password: string }> = [
  { id: "u-admin", fullName: "Admin AgriCapital", username: "admin", role: "admin", password: "admin", createdAt: Date.now() },
  { id: "u-agent", fullName: "Agent Daloa", username: "agent", role: "agent", password: "agent", createdAt: Date.now() },
];

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      hydrated: false,
      signIn: async (username, password) => {
        await new Promise((r) => setTimeout(r, 250));
        const u = SEED.find((x) => x.username === username && x.password === password);
        if (!u) throw new Error("Identifiants invalides");
        const { password: _p, ...safe } = u;
        set({ user: safe });
        return safe;
      },
      signOut: () => set({ user: null }),
    }),
    { name: "acremap-auth", onRehydrateStorage: () => () => setTimeout(() => useAuth.setState({ hydrated: true }), 0) }
  )
);

export const hasRole = (user: User | null, ...roles: Role[]) => !!user && roles.includes(user.role);
