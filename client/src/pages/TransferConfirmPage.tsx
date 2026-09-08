import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, ApiError, isSessionError } from "../api";
import { Layout } from "../components/Layout";
import { formatMinor } from "../money";
import { useSession } from "../session";
import type { TransferForm, TransferPreview } from "./TransferPage";

type State = { form: TransferForm; preview: TransferPreview };

export function TransferConfirmPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const state = location.state as State | null;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const idempotency = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!state?.form || !state.preview) {
      void navigate("/account/transfer", {
        replace: true,
        state: { notice: "Please review the transfer again." },
      });
    }
  }, [navigate, state]);

  if (!state?.form || !state.preview) return null;

  async function confirm() {
    if (!state) return;
    setPending(true);
    setError(undefined);
    try {
      const res = await api<{
        result: { amountMinor: string; balanceMinor: string; recipient: { name: string; accountNumber: string } };
      }>("/api/transfers", {
        method: "POST",
        body: JSON.stringify({ ...state.form, idempotencyKey: idempotency.current }),
      });
      void navigate("/account", {
        replace: true,
        state: {
          banner: {
            message: `Sent ${formatMinor(res.result.amountMinor)} to ${res.result.recipient.name} (${res.result.recipient.accountNumber}).`,
          },
        },
      });
    } catch (err) {
      if (isSessionError(err)) {
        session.expire();
        return;
      }
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Layout showBack>
      <section className="operation-page confirmation-page">
        <p className="eyebrow">Review transfer</p>
        <h1>Check before you send</h1>
        <div className="confirmation-card">
          <div>
            <span>Recipient</span>
            <strong>{state.preview.recipient.name}</strong>
          </div>
          <div>
            <span>Account number</span>
            <strong>{state.preview.recipient.accountNumber}</strong>
          </div>
          <div>
            <span>Amount</span>
            <strong className="confirmation-amount">{formatMinor(state.preview.amountMinor)}</strong>
          </div>
        </div>
        <div className="warning-panel">
          <strong>Make sure these details are correct.</strong>
          <span>Transferred funds may not be recoverable.</span>
        </div>
        {error && (
          <div className="error-panel" role="alert">
            {error}
          </div>
        )}
        <div className="confirmation-actions">
          <button
            className="secondary-button large-button"
            type="button"
            onClick={() => void navigate("/account/transfer", { state: { form: state.form } })}
          >
            Edit transfer
          </button>
          <button
            className="primary-button large-button"
            type="button"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? "Sending..." : "Confirm and send"}
          </button>
        </div>
      </section>
    </Layout>
  );
}
