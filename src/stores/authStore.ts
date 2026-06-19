import { create } from "zustand";
import type { User } from "@/types";
import { apiJson, getToken, setToken } from "@/api/client";

interface AuthUserResponse {
  id: string;
  username: string;
  email: string;
  created_at: string;
}

interface AuthLoginResponse {
  token: string;
  user: AuthUserResponse;
}

interface AuthState {
  user: User | null;
  token: string | null;
  hydrated: boolean;
  setAuth: (token: string, user: AuthUserResponse) => void;
  logout: () => void;
  hydrate: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
}

function mapUser(u: AuthUserResponse): User {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
  };
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  hydrated: false,
  setAuth: (token, u) => {
    setToken(token);
    set({ token, user: mapUser(u) });
  },
  logout: () => {
    setToken(null);
    set({ user: null, token: null });
  },
  hydrate: async () => {
    const token = getToken();
    if (!token) {
      set({ user: null, token: null, hydrated: true });
      return;
    }
    try {
      const data = await apiJson<{ user: AuthUserResponse }>("/api/auth/me");
      set({ token, user: mapUser(data.user), hydrated: true });
    } catch {
      setToken(null);
      set({ user: null, token: null, hydrated: true });
    }
  },
  login: async (username, password) => {
    const data = await apiJson<AuthLoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setToken(data.token);
    set({ token: data.token, user: mapUser(data.user) });
  },
  register: async (username, password) => {
    const data = await apiJson<AuthLoginResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setToken(data.token);
    set({ token: data.token, user: mapUser(data.user) });
  },
}));
