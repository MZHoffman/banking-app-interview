import { useState, type SubmitEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ACCOUNT_NAME, validateAccountNumber } from "../account";
import { api, ApiError, isSessionError } from "../api";
import { Layout } from "../components/Layout";
import { MoneyField } from "../components/MoneyField";
import { formatEditingMoney, validateMoney } from "../money";
import { useSession } from "../session";

export type TransferForm = { amount: string; recipientAccountNumber: string };
export type TransferPreview = {
  amountMinor: string;
  recipient: { name: string; accountNumber: string };
};

type TransferErrors = {
  amount?: string;
  recipient?: string;
  form?: string;
};

export function TransferPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const carried = location.state as { form?: TransferForm; notice?: string } | null;
  const [amount, setAmount] = useState(carried?.form?.amount ?? "");
  const [recipientAccountNumber, setRecipient] = useState(carried?.form?.recipientAccountNumber ?? "");
  const [errors, setErrors] = useState<TransferErrors>({});
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: TransferErrors = {};
    const amountError = validateMoney(amount);
    if (amountError) nextErrors.amount = amountError;
    const recipientError = validateAccountNumber(recipientAccountNumber);
    if (recipientError) nextErrors.recipient = recipientError;
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    setPending(true);
    setErrors({});
    try {
      const res = await api<{ preview: TransferPreview }>("/api/transfers/preview", {
        method: "POST",
        body: JSON.stringify({ amount, recipientAccountNumber }),
      });
      void navigate("/account/transfer/confirm", {
        state: { form: { amount, recipientAccountNumber }, preview: res.preview },
      });
    } catch (err) {
      if (isSessionError(err)) {
        session.expire();
        return;
      }
      setErrors({ form: err instanceof ApiError ? err.message : "Something went wrong. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <Layout showBack>
      <section className="operation-page transfer-page">
        <p className="eyebrow">{ACCOUNT_NAME}</p>
        <h1>Transfer money</h1>
        <p className="intro-copy">Enter the recipient's account number and the amount you want to send.</p>
        {carried?.notice && (
          <div className="notice-panel" role="status">
            {carried.notice}
          </div>
        )}
        <form className="operation-form" onSubmit={(event) => void submit(event)} noValidate>
          <div className="field-group">
            <label htmlFor="recipient">Recipient account number</label>
            <input
              id="recipient"
              className="account-number-input"
              type="text"
              inputMode="numeric"
              maxLength={5}
              value={recipientAccountNumber}
              onChange={(event) => {
                setRecipient(event.target.value);
                setErrors({});
              }}
              autoFocus
              aria-invalid={Boolean(errors.recipient)}
            />
            {errors.recipient && <p className="field-error">{errors.recipient}</p>}
          </div>
          <MoneyField
            value={amount}
            onChange={(value) => {
              setAmount(value);
              setErrors({});
            }}
            onBlur={() => setAmount(formatEditingMoney(amount))}
            error={errors.amount}
          />
          {errors.form && (
            <div className="error-panel" role="alert">
              {errors.form}
            </div>
          )}
          <button className="primary-button full-button large-button" disabled={pending} type="submit">
            {pending ? "Checking recipient..." : "Review transfer"}
          </button>
        </form>
      </section>
    </Layout>
  );
}
