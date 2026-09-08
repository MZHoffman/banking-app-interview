import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../session";

export function Layout({ children, showBack = false }: { children: ReactNode; showBack?: boolean }) {
  const session = useSession();
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="wordmark" to="/account" aria-label="Banking App account overview">
          Banking App
        </Link>
        <div className="header-actions">
          {showBack && (
            <Link className="text-link" to="/account">
              Back to account
            </Link>
          )}
          <button className="outline-button" type="button" onClick={() => void session.signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
