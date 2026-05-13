import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import type { User } from "@/types";
import { supabase } from "@/lib/supabase";

function mapUser(session: Session | null): User | null {
  const u = session?.user;
  if (!u) return null;
  const meta = u.user_metadata as { username?: string } | undefined;
  return {
    id: u.id,
    email: u.email ?? "",
    username: meta?.username ?? u.email?.split("@")[0] ?? "用户",
  };
}

interface AuthState {
  user: User | null;
  session: Session | null;
  hydrated: boolean;
  setSession: (session: Session | null) => void;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  hydrated: false,
  setSession: (session) => {
    set({
      session,
      user: mapUser(session),
    });
  },
  logout: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null });
  },
  hydrate: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    set({
      session,
      user: mapUser(session),
      hydrated: true,
    });
  },
}));
