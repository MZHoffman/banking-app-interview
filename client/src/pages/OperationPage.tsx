import { useRef, useState, type SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ACCOUNT_NAME } from "../account";
import { api, ApiError, isSessionError } from "../api";
import { Layout } from "../components/Layout";
import { MoneyField } from "../components/MoneyField";
import { formatEditingMoney, formatMinor, validateMoney } from "../money";
import { useSession } from "../session";

export function OperationPage({ type }: { type: "deposit" | "withdrawal" }) {
  const session = useSession();
  const navigate = useNavigate();
  const [amount, setAmount] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const attempt = useRef<{ payload: string; key: string } | undefined>(undefined);
  const title = type === "deposit" ? "Deposit money" : "Withdraw money";

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateMoney(amount);
    if (validation) {
      setFieldError(validation);
      return;
    }
    setPending(true);
    setFieldError(undefined);
    setFormError(undefined);
    if (!attempt.current || attempt.current.payload !== amount) {
      attempt.current = { payload: amount, key: crypto.randomUUID() };
    }
    try {
      const endpoint = type === "deposit" ? "/api/deposits" : "/api/withdrawals";
      const res = await api<{ result: { amountMinor: string; balanceMinor: string } }>(endpoint, {
        method: "POST",
        body: JSON.stringify({ amount, idempotencyKey: attempt.current.key }),
      });
      const verb = type === "deposit" ? "Deposited" : "Withdrew";
      await navigate("/account", {
        replace: true,
        state: { banner: { message: `${verb} ${formatMinor(res.result.amountMinor)} successfully.` } },
      });
    } catch (err) {
      if (isSessionError(err)) {
        session.expire();
        return;
      }
      if (err instanceof ApiError && err.fields?.amount) {
        setFieldError(err.fields.amount);
        return;
      }
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Layout showBack>
      <section className="operation-page">
        <p className="eyebrow">{ACCOUNT_NAME}</p>
        <h1>{title}</h1>
        <p className="intro-copy">Enter the amount in pounds and pence.</p>
        <form className="operation-form" onSubmit={(event) => void submit(event)} noValidate>
          <MoneyField
            value={amount}
            onChange={(value) => {
              setAmount(value);
              setFieldError(undefined);
              setFormError(undefined);
            }}
            onBlur={() => setAmount(formatEditingMoney(amount))}
            error={fieldError}
            autoFocus
          />
          {formError && (
            <div className="error-panel" role="alert">
              {formError}
            </div>
          )}
          <button className="primary-button full-button large-button" disabled={pending} type="submit">
            {pending ? "Processing..." : type === "deposit" ? "Deposit money" : "Withdraw money"}
          </button>
        </form>
      </section>
    </Layout>
  );
}
