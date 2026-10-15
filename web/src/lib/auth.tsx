import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, whenSignedOut, type Role, type User } from "./api";

interface AuthState {
  user: User | null | undefined;
  logIn: (email: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Who is signed in. `undefined` while checking, `null` when signed out. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>();

  useEffect(() => {
    whenSignedOut(() => setUser(null));
    api.me().then(setUser, () => setUser(null));
  }, []);

  const value: AuthState = {
    user,
    logIn: async (email, password) => setUser(await api.logIn(email, password)),
    logOut: async () => {
      await api.logOut().catch(() => undefined);
      setUser(null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside <AuthProvider>");
  return auth;
}

/** The signed-in user (only call inside the signed-in app). */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("Not signed in");
  return user;
}

/** What each role may do, mirroring the server's checks so buttons only show when they'll work. */
export function can(role: Role, action: "manage_clients" | "delete_clients" | "manage_keys" | "manage_repos" | "restore_demo"): boolean {
  switch (action) {
    case "manage_keys":
    case "delete_clients":
      return role === "admin";
    case "manage_clients":
    case "manage_repos":
    case "restore_demo":
      return role === "admin" || role === "lead";
  }
}
