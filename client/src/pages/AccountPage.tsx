import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ACCOUNT_NAME } from "../account";
import { api, ApiError, isSessionError } from "../api";
import { Layout } from "../components/Layout";
import { formatMinor } from "../money";
import { useSession } from "../session";

type Account = {
  holderName: string;
  accountNumber: string;
  balanceMinor: string;
};

type Banner = { message: string };

export function AccountPage() {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account>();
  const [error, setError] = useState<string>();
  const [banner, setBanner] = useState((location.state as { banner?: Banner } | null)?.banner);

  useEffect(() => {
    if (location.state) void navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    api<{ account: Account }>("/api/account")
      .then((res) => setAccount(res.account))
      .catch((err) => {
        if (isSessionError(err)) {
          session.expire();
          return;
        }
        setError(err instanceof ApiError ? err.message : "Unable to load your account.");
      });
  }, [session]);

  return (
    <Layout>
      <section className="dashboard">
        <div className="dashboard-heading">
          <p className="eyebrow">Account overview</p>
          <h1>Hello, {session.user?.firstName}</h1>
        </div>
        {banner && (
          <div className="success-panel" role="status">
            <span>{banner.message}</span>
            <button type="button" onClick={() => setBanner(undefined)}>
              Dismiss
            </button>
          </div>
        )}
        {error && (
          <div className="error-panel" role="alert">
            {error}
          </div>
        )}
        {!account && !error ? (
          <div className="account-card loading-card">Loading your account...</div>
        ) : account ? (
          <article className="account-card">
            <div className="account-meta">
              <div>
                <p className="account-label">{ACCOUNT_NAME}</p>
                <p className="holder-name">{account.holderName}</p>
              </div>
              <div className="account-number">
                <span>Account number</span>
                <strong>{account.accountNumber}</strong>
              </div>
            </div>
            <div className="balance-block">
              <p>Available balance</p>
              <strong>{formatMinor(account.balanceMinor)}</strong>
            </div>
            <div className="account-actions">
              <Link className="primary-button" to="/account/deposit">
                Deposit
              </Link>
              <Link className="primary-button" to="/account/withdraw">
                Withdraw
              </Link>
              <Link className="primary-button" to="/account/transfer">
                Transfer
              </Link>
            </div>
          </article>
        ) : null}
      </section>
    </Layout>
  );
}
