import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiNoContent } from "./api";

type User = { firstName: string; lastName: string };
type SessionStatus = "loading" | "authenticated" | "unauthenticated" | "expired";

type SessionContextValue = {
  status: SessionStatus;
  user?: User;
  establish: (user: User) => void;
  signOut: () => Promise<void>;
  expire: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);
const IDLE_TIMEOUT = 10 * 60 * 1000;
const HEARTBEAT_INTERVAL = 2 * 60 * 1000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<User>();
  const lastActivity = useRef(Date.now());

  const expire = useCallback(() => {
    setUser(undefined);
    setStatus("expired");
    void navigate("/session-expired", { replace: true });
  }, [navigate]);

  useEffect(() => {
    api<{ user: User }>("/api/auth/session")
      .then((res) => {
        setUser(res.user);
        setStatus("authenticated");
      })
      .catch(() => setStatus("unauthenticated"));
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    const registerActivity = () => {
      if (!document.hidden) lastActivity.current = Date.now();
    };
    const events: (keyof WindowEventMap)[] = ["keydown", "pointerdown", "touchstart"];
    for (const event of events) window.addEventListener(event, registerActivity, { passive: true });
    document.addEventListener("visibilitychange", registerActivity);

    const timer = window.setInterval(() => {
      const inactiveFor = Date.now() - lastActivity.current;
      if (inactiveFor >= IDLE_TIMEOUT) {
        void apiNoContent("/api/auth/sign-out", { method: "POST" })
          .catch(() => undefined)
          .finally(expire);
      } else if (inactiveFor < HEARTBEAT_INTERVAL) {
        apiNoContent("/api/auth/heartbeat", { method: "POST" }).catch(expire);
      }
    }, HEARTBEAT_INTERVAL);

    return () => {
      window.clearInterval(timer);
      for (const event of events) window.removeEventListener(event, registerActivity);
      document.removeEventListener("visibilitychange", registerActivity);
    };
  }, [expire, status]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      ...(user ? { user } : {}),
      establish(nextUser) {
        lastActivity.current = Date.now();
        setUser(nextUser);
        setStatus("authenticated");
      },
      async signOut() {
        await apiNoContent("/api/auth/sign-out", { method: "POST" }).catch(() => undefined);
        setUser(undefined);
        setStatus("unauthenticated");
        void navigate("/sign-in", { replace: true });
      },
      expire,
    }),
    [expire, navigate, status, user],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within SessionProvider");
  return value;
}
