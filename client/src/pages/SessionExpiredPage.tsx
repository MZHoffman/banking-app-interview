import { Link } from "react-router-dom";
import securityIcon from "../assets/security-icon.png";

export function SessionExpiredPage() {
  return (
    <main className="sign-in-page">
      <section className="sign-in-card session-card">
        <div className="security-icon" aria-hidden="true">
          <img src={securityIcon} width={22} height={22} alt="" />
        </div>
        <p className="eyebrow">Security timeout</p>
        <h1>You've been signed out</h1>
        <p className="intro-copy">For your security, we signed you out after more than 10 minutes of inactivity.</p>
        <Link className="primary-button full-button" to="/sign-in">
          Sign in again
        </Link>
      </section>
    </main>
  );
}
