type Props = {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string | undefined;
  autoFocus?: boolean;
};

export function MoneyField({ value, onChange, onBlur, error, autoFocus }: Props) {
  return (
    <div className="field-group">
      <label htmlFor="amount">Amount</label>
      <div className={`money-input ${error ? "input-error" : ""}`}>
        <span aria-hidden="true">£</span>
        <input
          id="amount"
          name="amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          maxLength={40}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          autoFocus={autoFocus}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "amount-error" : undefined}
          placeholder="0.00"
        />
      </div>
      {error && (
        <p className="field-error" id="amount-error">
          {error}
        </p>
      )}
    </div>
  );
}
