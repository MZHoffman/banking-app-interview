import { useState, type SubmitEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useSession } from "../session";

type PasswordCredentialCtor = new (data: { id: string; name: string; password: string }) => Credential;

async function savePassword(email: string, password: string, name: string): Promise<void> {
  const Ctor = (globalThis as typeof globalThis & { PasswordCredential?: PasswordCredentialCtor }).PasswordCredential;

  if (!Ctor || !navigator.credentials?.store) return;

  try {
    await navigator.credentials.store(new Ctor({ id: email, name, password }));
  } catch {
    // Optional, and never a reason to block a valid sign-in.
  }
}

export function SignInPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  if (session.status === "authenticated") return <Navigate to="/account" replace />;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setPending(true);
    try {
      const res = await api<{ user: { firstName: string; lastName: string } }>("/api/auth/sign-in", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await savePassword(email, password, `${res.user.firstName} ${res.user.lastName}`);
      session.establish(res.user);
      void navigate("/account", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="sign-in-page">
      <section className="sign-in-card">
        <div className="wordmark sign-in-wordmark">Banking App</div>
        <p className="eyebrow">Demo banking application</p>
        <h1>Welcome back</h1>
        <p className="intro-copy">Sign in to view and manage your current account.</p>
        <form autoComplete="on" onSubmit={(event) => void submit(event)} noValidate>
          <div className="field-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="username"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error && (
            <div className="error-panel" role="alert">
              {error}
            </div>
          )}
          <button className="primary-button full-button" disabled={pending} type="submit">
            {pending ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="demo-hint">Use one of the demo accounts listed in the README.</p>
      </section>
    </main>
  );
}
