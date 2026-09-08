import moneySource from "../../../../server/src/money/module.ts?raw";
import amountSource from "../../../../server/src/money/amount.ts?raw";
import schemaSource from "../../../../database/migrations/001_initial_schema.sql?raw";
import appSource from "../../../../server/src/app.ts?raw";
import sessionSource from "../../../../server/src/security/session.ts?raw";
import passwordSource from "../../../../server/src/security/password.ts?raw";
import errorsSource from "../../../../server/src/errors.ts?raw";
import clientAmountSource from "../../money.ts?raw";
import clientAccountSource from "../../account.ts?raw";

function excerpt(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Reviewer excerpt is out of date: ${start}`);
  return source.slice(from, to).trimEnd();
}

// The deposit and withdrawal path, sliced out first so that excerpting its catch
// block cannot accidentally match the transfer one further down the same file.
const runOperationSource = moneySource.slice(
  moneySource.indexOf("  async function runOperation("),
  moneySource.indexOf("  async function previewTransfer("),
);

export function CodeSample({ title, file, code }: { title: string; file: string; code: string }) {
  return (
    <figure className="review-code review-code-sample">
      <figcaption>
        <strong>{title}</strong>
        <span>{file} · exact source excerpt</span>
      </figcaption>
      <pre tabIndex={0} aria-label={`${title} code`}>
        <code>{code}</code>
      </pre>
    </figure>
  );
}

const safeguards = [
  [
    "Positive, exact money",
    "Reject malformed decimals and zero with BigInt parsing.",
    "Parse independently; enforce the signed BIGINT ceiling.",
    "BIGINT + NOT NULL + CHECK (amount_minor > 0).",
  ],
  [
    "No overdraft",
    "Display a declined operation; browser state is not authoritative.",
    "Lock first, then compare the amount with the current balance.",
    "CHECK (balance_minor >= 0) rejects a negative write.",
  ],
  [
    "No overflow",
    "Keep amounts and balances out of JavaScript Number.",
    "ensureBigintRange checks a credited balance before SQL.",
    "BIGINT rejects values outside its representable range.",
  ],
  [
    "Valid recipient",
    "Validate the five-digit account format before preview.",
    "Strict schema, recipient lookup and self-transfer rejection.",
    "Account format CHECK, UNIQUE, foreign keys and source <> destination.",
  ],
  [
    "One effect per retry key",
    "Keep the same UUID for retries of the mounted confirmation.",
    "Compare the complete operation before returning an old result.",
    "A global UNIQUE constraint arbitrates competing inserts.",
  ],
  [
    "Complete transfer",
    "Preview and confirmation are separate; pending controls limit repeat clicks.",
    "One checked-out client; insert and both updates inside BEGIN / COMMIT.",
    "Transaction atomicity, account row locks and record-shape constraints.",
  ],
];

export function MoneyDefences() {
  return (
    <div className="review-deep-dive">
      <span className="review-kicker">DEFENCE IN DEPTH</span>
      <h3>Different layers protect the same invariant.</h3>
      <p>
        The browser helps a person correct an input. The backend treats that input as untrusted. PostgreSQL refuses
        invalid stored state even if a script or future route bypasses the form. These layers overlap, but each has a
        different job.
      </p>
      <div className="review-table-wrap">
        <table className="review-table review-defence-table">
          <thead>
            <tr>
              <th>Invariant</th>
              <th>Browser</th>
              <th>Backend</th>
              <th>Database</th>
            </tr>
          </thead>
          <tbody>
            {safeguards.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, index) =>
                  index === 0 ? (
                    <th key={index} scope="row">
                      {cell}
                    </th>
                  ) : (
                    <td key={index}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="review-subheading">1. Parse twice; never round money into validity.</h3>
      <p>
        The client rejects invalid input quickly. The API accepts an amount string, then the money module parses it
        again. An attacker can bypass the first check, so the second is authoritative. Neither path repairs{" "}
        <code>"1.234"</code> into an amount the user did not submit.
      </p>
      <CodeSample
        title="Client: grammar and positive minor units"
        file="client/src/money.ts"
        code={excerpt(clientAmountSource, "const PATTERN", "export function formatEditingMoney")}
      />
      <CodeSample
        title="Backend: exact conversion and storage range"
        file="server/src/money/amount.ts"
        code={amountSource.slice(amountSource.indexOf("const MAX_BIGINT"))}
      />
      <p>
        <code>NOT NULL</code> is another protection alongside the amount check: SQL CHECK constraints alone allow a null
        result. <code>BIGINT</code> supplies the numeric range, while <code>CHECK</code> supplies the business sign
        rule. The server produces useful validation errors before the database becomes the final backstop.
      </p>
      <h3 className="review-subheading">2. Available funds are checked while the rows are locked.</h3>
      <CodeSample
        title="Transfer: read current balances, prevent overdraft, check credit overflow"
        file="server/src/money/module.ts · transfer"
        code={excerpt(moneySource, "      const sourceBalance =", "      await client.query(\n        `INSERT")}
      />
      <p>
        With £100 available and two simultaneous £80 transfers, the first locks the sender and leaves £20. The second
        waits, then checks £80 against £20 and fails. Without the lock, both could validate the same stale £100. The
        nonnegative-balance constraint is essential, but it cannot by itself prevent a lost update that writes a stale,
        still-positive number.
      </p>
      <h3 className="review-subheading">3. The database rejects malformed accounts and records.</h3>
      <CodeSample
        title="Accounts: one owner, one public number, nonnegative balance"
        file="database/migrations/001_initial_schema.sql"
        code={excerpt(schemaSource, "CREATE TABLE accounts", "CREATE TABLE money_transactions")}
      />
      <CodeSample
        title="Transaction records: valid shape, positive amount, unique key"
        file="database/migrations/001_initial_schema.sql"
        code={excerpt(schemaSource, "CREATE TABLE money_transactions", "CREATE INDEX money_transactions_source_idx")}
      />
      <p>
        A deposit has only a destination; a withdrawal has only a source; a transfer has both, and they must differ.
        Foreign keys require existing accounts and users. <code>ON DELETE RESTRICT</code> prevents deleting rows that
        these records still reference. <code>balance_after_minor</code> also has a nonnegative check, so even the
        recorded receipt cannot contain a negative balance.
      </p>
      <p>
        The other two tables carry their own constraints. Identity is canonicalized at the boundary and then pinned by
        the schema, and a session row cannot claim to have expired before it existed.
      </p>
      <CodeSample
        title="Users: canonical email, non-blank names"
        file="database/migrations/001_initial_schema.sql"
        code={excerpt(schemaSource, "CREATE TABLE users", "CREATE TABLE sessions")}
      />
      <CodeSample
        title="Sessions: unique token digest, coherent lifetime, supporting indexes"
        file="database/migrations/001_initial_schema.sql"
        code={excerpt(schemaSource, "CREATE TABLE sessions", "CREATE TABLE accounts")}
      />
      <p>
        <code>users_email_canonical</code> is the third copy of one rule. Zod lowercases and trims at the trust
        boundary, sign-in looks the address up by that normalized value, and the <code>CHECK</code> makes a
        non-canonical row unstorable — so a seed script or a future admin path cannot create the second account that
        would make <code>email</code> ambiguous. <code>token_hash BYTEA NOT NULL UNIQUE</code> applies the same
        reasoning to sessions: the digest, never the token, and no two rows may share one.
      </p>
      <h3 className="review-subheading">4. Delete behaviour is chosen per table, not set once.</h3>
      <div className="review-table-wrap">
        <table className="review-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>On delete</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">
                <code>sessions.user_id</code>
              </th>
              <td>
                <code>CASCADE</code>
              </td>
              <td>A session is disposable credential state. Removing a user should invalidate their sessions.</td>
            </tr>
            <tr>
              <th scope="row">
                <code>accounts.user_id</code>
              </th>
              <td>
                <code>RESTRICT</code>
              </td>
              <td>An account holds a balance. Deleting its owner must fail rather than discard money.</td>
            </tr>
            <tr>
              <th scope="row">
                <code>money_transactions</code> (all three)
              </th>
              <td>
                <code>RESTRICT</code>
              </td>
              <td>The ledger is the audit record. No delete elsewhere may silently orphan or remove history.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        This asymmetry is the point. A single blanket <code>CASCADE</code> would make <code>DELETE FROM users</code>{" "}
        quietly erase accounts and their transaction history; <code>RESTRICT</code> turns that into an error the caller
        has to handle deliberately. Credential state is cheap to discard, financial records are not, and the schema
        encodes that difference rather than leaving it to whoever writes the next query.
      </p>
      <p className="review-callout">
        <strong>What SQL does not prove here.</strong> There is no trigger enforcing that the debit equals the credit,
        that a transaction amount matches the balance delta, or that the initiating user owns the source. Those
        relationships are enforced by the money module and verified in integration tests. A direct SQL write could
        bypass them while satisfying the table checks.
      </p>
      <h3 className="review-subheading">5. The receipt and the money share one commit.</h3>
      <CodeSample
        title="Transfer: record, debit, credit, commit"
        file="server/src/money/module.ts · transfer"
        code={excerpt(
          moneySource,
          "      await client.query(\n        `INSERT INTO money_transactions(\n           id, idempotency_key, type, amount_minor, source_account_id,\n           destination_account_id, initiated_by_user_id, balance_after_minor\n         ) VALUES ($1, $2, 'transfer'",
          "      return {\n        balanceMinor: sourceAfter",
        )}
      />
      <p>
        The insert happens before the updates, but none of these writes is committed independently. A constraint error
        on the credit rolls the debit and receipt back too. This guarantee depends on using the same checked-out client
        throughout; independent <code>pool.query</code> calls would not establish one shared transaction.
      </p>
      <h3 className="review-subheading">6. The account-number rule is written three times, deliberately.</h3>
      <p>
        A five-digit number beginning with a non-zero digit. The form checks it to fail fast, the API schema checks it
        because the form can be bypassed, and the table checks it because the API is not the only thing that can ever
        write a row. The source comment in <code>app.ts</code> states the reasoning: a lenient client is a cosmetic bug,
        a lenient server is a hole.
      </p>
      <CodeSample
        title="Layer 1 — the browser, for fast feedback"
        file="client/src/account.ts"
        code={excerpt(clientAccountSource, "// Mirrors the server rule", "export function validateAccountNumber")}
      />
      <CodeSample
        title="Layer 2 — the trust boundary, authoritative for requests"
        file="server/src/app.ts"
        code={excerpt(appSource, "// The account-number format", "const transferSchema")}
      />
      <CodeSample
        title="Layer 3 — the schema, authoritative for stored state"
        file="database/migrations/001_initial_schema.sql"
        code={excerpt(schemaSource, "  -- The API validates this too", "\n);")}
      />
      <p>
        <code>.strict()</code> on every schema is doing quiet work here. An unrecognized property is rejected rather
        than ignored, so a request cannot smuggle a <code>userId</code> field past validation and hope some later
        handler reads it. The acting identity is only ever taken from the verified session.
      </p>
      <h3 className="review-subheading">7. Deposits and withdrawals take the identical path.</h3>
      <p>
        Transfers get the attention because they touch two rows, but the single-account operations are not a shortcut.
        They lock first, resolve idempotency inside the transaction, check funds against the locked balance, and write
        the record and the balance together.
      </p>
      <CodeSample
        title="Lock the caller's own account by session identity, not by a request field"
        file="server/src/money/module.ts · lockOwnAccount"
        code={excerpt(moneySource, "async function lockOwnAccount(", "export function createMoneyModule")}
      />
      <CodeSample
        title="Deposit and withdrawal: one transaction, lock, replay check, funds check, write"
        file="server/src/money/module.ts · runOperation"
        code={excerpt(
          runOperationSource,
          '      await client.query("BEGIN"); // start transaction',
          "    } catch (error) {",
        )}
      />
      <p>
        The <code>WHERE a.user_id = $1</code> clause is the authorization check: there is no account identifier in the
        deposit or withdrawal request at all, so there is nothing for a caller to tamper with. A withdrawal compares{" "}
        <code>amount &gt; current</code> against the balance it just locked, and a deposit range-checks the credited
        result through <code>ensureBigintRange</code> before it reaches SQL. Only the credited side can overflow — a
        debit strictly decreases — which is why the check appears on one branch and not both.
      </p>
    </div>
  );
}

export function LockDetails() {
  return (
    <div className="review-deep-dive">
      <h3>Resolve ownership, then lock the pair.</h3>
      <CodeSample
        title="The sender comes from the session; lock order comes from UUIDs"
        file="server/src/money/module.ts · transfer"
        code={excerpt(
          moneySource,
          "      const ids = await client.query",
          "      const existing = await findExisting(client, input.idempotencyKey);",
        )}
      />
      <p>
        The first query derives the source from <code>input.userId</code>, which the route supplies from the
        authenticated session. The recipient is resolved by account number. The lock query returns both rows in UUID
        order; the code then finds their source and destination roles explicitly, rather than assuming the first row is
        the sender.
      </p>
      <p>
        <code>FOR UPDATE OF a</code> targets the account rows despite joining user names. The transaction uses the
        database connection’s configured isolation level; the application does not issue{" "}
        <code>SET TRANSACTION ISOLATION LEVEL</code>. With PostgreSQL’s usual READ COMMITTED default, a waiting
        operation sees the updated row after acquiring its lock.
      </p>
    </div>
  );
}

export function ReplayDetails() {
  const transferStart = moneySource.indexOf("  async function transfer(");
  const transfer = moneySource.slice(transferStart);
  return (
    <div className="review-deep-dive">
      <h3>The comparison is the authorization check for a receipt.</h3>
      <CodeSample
        title="Replay must match type, amount, accounts and acting user"
        file="server/src/money/module.ts · replayOf, replayOfTransfer"
        code={excerpt(moneySource, "function replayOf(", "async function lockOwnAccount")}
      />
      <p>
        A UUID is not permission to read somebody else’s result. Comparing <code>initiated_by_user_id</code> as well as
        account IDs prevents a caller from treating another user’s key as their own receipt. Amounts are compared after
        normalization to minor units, so equivalent accepted decimal inputs represent the same value.
      </p>
      <CodeSample
        title="The full transfer catch and cleanup path"
        file="server/src/money/module.ts · transfer"
        code={excerpt(transfer, "    } catch (error) {", "\n  return {\n    deposit:")}
      />
      <p>
        The recovery lookup runs on the checked-out client after rollback. The account-pair lookup uses{" "}
        <code>pool.query</code>, then replay verification uses the original request’s identity and amount. The{" "}
        <code>finally</code> block releases the checked-out client even when the catch returns a receipt or replay
        validation throws a conflict.
      </p>
    </div>
  );
}

export function IdempotencyLayers() {
  return (
    <div className="review-deep-dive">
      <span className="review-kicker">THREE LAYERS, ONE INVARIANT</span>
      <h3>Applied at most once — defended three separate ways.</h3>
      <p>
        “One effect per key” is not protected by a single mechanism. Three independent things have to fail before a
        duplicate operation could be applied twice, and each one covers a case the others cannot.
      </p>
      <ol className="review-steps">
        <li>
          <strong>The row lock, acquired before the key is read.</strong>
          <p>
            The statement order inside the transaction is <code>BEGIN</code> → lock the accounts →{" "}
            <code>findExisting</code>. That ordering is what makes the common retry cheap: a duplicate for the same
            account blocks on the lock, and by the time it reads the key the first operation has committed. Reading the
            key before locking would let both requests see “no such key” and proceed.
          </p>
        </li>
        <li>
          <strong>The key lookup inside the same transaction.</strong>
          <p>
            A recorded key returns its stored receipt instead of moving money again — but only after every field
            matches. This is the layer that handles the ordinary case of a lost response and a retried request.
          </p>
        </li>
        <li>
          <strong>
            The <code>UNIQUE</code> constraint, as the last word.
          </strong>
          <p>
            <code>idempotency_key UUID NOT NULL UNIQUE</code> is global, not per account. Two operations on{" "}
            <em>disjoint</em> accounts share no lock, so layer 1 never serializes them and layer 2 can clear both.
            PostgreSQL then rejects the second insert with <code>23505</code>, and the catch block resolves it.
          </p>
        </li>
      </ol>
      <CodeSample
        title="Locked rows first, then the key — the order is the mechanism"
        file="server/src/money/module.ts · transfer"
        code={excerpt(
          moneySource,
          "      const existing = await findExisting(client, input.idempotencyKey);\n      if (existing) {\n        const res = replayOfTransfer(",
          "      const sourceBalance =",
        )}
      />
      <CodeSample
        title="The same recovery on the deposit and withdrawal path"
        file="server/src/money/module.ts · runOperation"
        code={excerpt(runOperationSource, "    } catch (error) {", "    } finally {")}
      />
      <p className="review-callout">
        <strong>A reused key from a different caller is a conflict, not a receipt.</strong> When two users submit the
        same key, the loser of the insert race reaches <code>replayOf</code>, which compares{" "}
        <code>initiated_by_user_id</code> and both account IDs. They do not match, so the request fails with{" "}
        <code>409 IDEMPOTENCY_CONFLICT</code> rather than returning somebody else’s balance. The uniqueness of the key
        is what detects the collision; the field comparison is what refuses to leak across it.
      </p>
      <p>
        The honest limit: this makes an operation idempotent <em>per key</em>. It does not deduplicate two genuinely
        distinct requests that happen to be identical in amount and recipient — those carry different keys and are both
        meant to apply. Deciding that a user “probably did not mean to send £50 twice” is a product question, and this
        application does not answer it.
      </p>
    </div>
  );
}

export function SecurityDetails() {
  return (
    <div className="review-deep-dive">
      <span className="review-kicker">SECURITY IN THE SOURCE</span>
      <h3>Trace the checks, from the request to the session record.</h3>
      <CodeSample
        title="Reject extra fields and validate the operation key"
        file="server/src/app.ts"
        code={excerpt(appSource, "const operationSchema", "// The account-number format")}
      />
      <CodeSample
        title="Revalidate recipient shape and carry the idempotency key"
        file="server/src/app.ts"
        code={excerpt(appSource, "const transferPreviewSchema", "function asyncRoute")}
      />
      <CodeSample
        title="Require a session before invoking a transfer"
        file="server/src/app.ts"
        code={excerpt(appSource, '  app.post(\n    "/api/transfers",', "  app.use(notFoundHandler)")}
      />
      <p>
        The request cannot overwrite <code>userId</code>: the strict input schema does not allow that field. The route
        checks the session, applies the shared transfer limiter, parses the body, and passes a server-derived identity
        into the money module.
      </p>
      <CodeSample
        title="Reject missing or unexpected origins on mutations"
        file="server/src/app.ts"
        code={excerpt(appSource, "  app.use((req, _res, next) => {", "  const signInLimiter")}
      />
      <CodeSample
        title="Fresh opaque tokens; only the digest is stored"
        file="server/src/security/session.ts"
        code={excerpt(sessionSource, "  async function createSession(", "  async function destroySession(")}
      />
      <p>
        Hashing a high-entropy session token and hashing a human password solve different problems. Session tokens have
        32 random bytes, so the server uses SHA-256 for lookup. Passwords can be weak or reused, so scrypt deliberately
        makes each guess costly.
      </p>
      <CodeSample
        title="Random salt, stored parameters and timing-safe verification"
        file="server/src/security/password.ts"
        code={passwordSource.slice(passwordSource.indexOf("export async function hashPassword"))}
      />
      <p>
        The surrounding constants set <code>N = 2 ** 17</code>, <code>r = 8</code>, <code>p = 1</code>, a 32-byte
        derived key and a 256 MiB memory cap. The asynchronous Node API avoids synchronous hashing on the event loop,
        but hashing still consumes finite worker and memory capacity.
      </p>
      <h3 className="review-subheading">An unknown email costs the same as a known one.</h3>
      <p>
        The cheapest way to leak an account list is to answer faster when the email does not exist. Sign-in avoids that
        by hashing against a throwaway digest generated at startup, so the expensive scrypt verification runs on every
        attempt whatever the outcome.
      </p>
      <CodeSample
        title="A decoy digest, created once at startup"
        file="server/src/app.ts"
        code={excerpt(appSource, "  // Unknown emails are checked", '  app.disable("x-powered-by");')}
      />
      <CodeSample
        title="Verify unconditionally, then decide — one message for both failures"
        file="server/src/app.ts"
        code={excerpt(appSource, '  app.post(\n    "/api/auth/sign-in",', '  app.post(\n    "/api/auth/sign-out",')}
      />
      <p>
        Note <code>user?.password_digest ?? decoyDigest</code>: the <code>await verifyPassword</code> is not inside the
        <code>if</code>. A missing user and a wrong password produce the same <code>401</code> and the same{" "}
        <code>“The email or password is incorrect.”</code> This equalizes the dominant cost, not every nanosecond — the
        database lookup still differs — so it is a mitigation of an enumeration oracle rather than a proof of constant
        time.
      </p>
      <h3 className="review-subheading">Two rate limiters, keyed on different things.</h3>
      <CodeSample
        title="Credential stuffing and transfer flooding are different problems"
        file="server/src/app.ts"
        code={excerpt(appSource, "  const signInLimiter = rateLimit({", '  app.post(\n    "/api/auth/sign-in",')}
      />
      <p>
        Sign-in is keyed on <code>IP + email</code> so one address cannot walk a password list against many accounts,
        and <code>skipSuccessfulRequests</code> means a legitimate user is not punished for their own successful logins.
        Transfers are keyed on the <em>authenticated user id</em>, because by then identity is known and is a better
        subject than a shared NAT address. Both convert a limiter rejection into the application’s own{" "}
        <code>429 RATE_LIMITED</code> shape rather than the library’s default body.
      </p>
      <h3 className="review-subheading">Sessions expire two ways, and are swept when nobody returns.</h3>
      <CodeSample
        title="Absolute lifetime, idle lifetime, and a throttled activity write"
        file="server/src/security/session.ts · requireSession"
        code={excerpt(sessionSource, "  const requireSession: RequestHandler", "  async function createSession(")}
      />
      <p>
        A session dies at <code>expires_at</code> (8 hours, fixed at creation) or after 10 minutes of inactivity,
        whichever comes first. The check does both, and an expired or idle row is <em>deleted</em> and its cookie
        cleared on the spot rather than merely rejected. The activity timestamp is only rewritten once a minute — with a
        ten-minute idle window there is no accuracy to gain from a row write on every authenticated request.
      </p>
      <CodeSample
        title="The sweep, and why it only looks at absolute expiry"
        file="server/src/security/session.ts"
        code={excerpt(sessionSource, "// Absolute expiry only", "function tokenHash(")}
      />
      <p>
        The comment records a real index trade-off: <code>sessions_expiry_idx</code> serves <code>expires_at</code>, and
        adding <code>OR last_activity_at &lt; …</code> would need a second index on a column written on almost every
        request. Idle rows are left to their absolute expiry because <code>requireSession</code> already refuses and
        deletes them the moment anyone presents one.
      </p>
      <h3 className="review-subheading">Failures are correlated, not narrated.</h3>
      <CodeSample
        title="Known errors keep their shape; unknown ones become a generic 500"
        file="server/src/errors.ts"
        code={errorsSource.slice(errorsSource.indexOf("export const errorHandler"))}
      />
      <p>
        An unexpected error is logged server-side with its request id and answered with{" "}
        <code>“Something went wrong. Please try again.”</code> — no stack, no SQL, no constraint name. The{" "}
        <code>X-Request-ID</code> header and the <code>requestId</code> in the body let a reviewer join a response to
        its log line without the response itself describing the internals. Zod issues are flattened to one message per
        field, which is what the forms render.
      </p>
      <CodeSample
        title="Request hardening applied before any route runs"
        file="server/src/app.ts"
        code={excerpt(appSource, "  app.use(helmet(", "  app.use((req, _res, next) => {")}
      />
      <p>
        A 20&nbsp;kB JSON ceiling keeps a large body from reaching the parser, <code>helmet</code> sets the standard
        response headers, and <code>x-powered-by</code> is disabled so the stack is not advertised. HSTS is switched off
        deliberately: the app is served over local HTTP, and a browser must ignore an HSTS header on a plain-HTTP
        response anyway.
      </p>
    </div>
  );
}

export function OptionsConsidered() {
  return (
    <div className="review-deep-dive">
      <span className="review-kicker">ALTERNATIVES CONSIDERED</span>
      <h3>Should a single operation have a maximum amount?</h3>
      <p>
        The decision register answers “no” — see <em>No maximum operation amount</em> in the decision record, and Q14 in
        the engineering Q&amp;A. That is a deliberate choice rather than an oversight, and three concrete alternatives
        were weighed before settling on it. Each is written out here with what it would actually cost, because a
        decision is only reviewable next to the options it beat.
      </p>
      <ol className="review-steps">
        <li>
          <strong>Option A — a per-operation cap in the money module.</strong>
          <p>
            The smallest change: one constant beside <code>MAX_BIGINT</code> in <code>server/src/money/amount.ts</code>,
            enforced in <code>parseAmountMinor</code>, unit-testable with no database. Two existing assertions constrain
            the value. <code>money/amount.test.ts</code> requires <code>"123456.78"</code> to parse to{" "}
            <code>12_345_678n</code>, so any cap below £123,456.78 breaks it; and{" "}
            <code>transfers.integration.test.ts</code> asserts the exact over-range message, so a new branch has to
            reuse that wording rather than introduce its own. A £1,000,000 cap (<code>100_000_000n</code> minor units)
            satisfies both.
          </p>
        </li>
        <li>
          <strong>Option B — rate-limit deposits and withdrawals.</strong>
          <p>
            Applies the limiter that already guards the transfer routes to <code>/api/deposits</code> and{" "}
            <code>/api/withdrawals</code>, closing the gap this guide records under <em>Local rate limits</em>. It
            bounds how <em>often</em> an operation can run, not how large one may be — a different invariant, and not a
            substitute for a cap. It also needs the test database to verify, and the limiter is currently named for
            transfers, so adopting it elsewhere means renaming it.
          </p>
        </li>
        <li>
          <strong>Option C — a funds warning on the transfer review screen.</strong>
          <p>
            Addresses the honest UX cost that a preview is not a reservation: the review screen can show a balance
            without warning that the amount exceeds it. This is advisory only — the authoritative check stays on the
            server against locked rows. It is also the most invasive of the three, spanning client and server, and the
            current behaviour is pinned by both an integration test and a browser journey, so existing assertions would
            have to change rather than being added to.
          </p>
        </li>
      </ol>
      <p className="review-callout">
        <strong>Chosen: none of them, on purpose.</strong> A cap would be an invented business rule with no product
        behind it. What remains in force is not nothing: amounts must be positive, must parse to at most two decimal
        places, must fall inside the signed <code>BIGINT</code> range, and withdrawals and transfers require available
        funds against a locked row. The recorded next step is configurable per-operation, daily and risk-based limits —
        which is a product decision, not a constant.
      </p>
      <h3 className="review-subheading">Why a cap would not touch ensureBigintRange.</h3>
      <CodeSample
        title="A different invariant: the resulting balance, not the operation size"
        file="server/src/money/amount.ts"
        code={amountSource.slice(amountSource.indexOf("export function ensureBigintRange"))}
      />
      <p>
        This is worth separating because the two checks look similar and are not. <code>parseAmountMinor</code> bounds
        the <em>amount a caller submitted</em>; <code>ensureBigintRange</code> bounds the{" "}
        <em>balance an operation would produce</em>. The overflow test sets both balances near <code>MAX_BIGINT</code>{" "}
        and transfers <code>0.01</code> — an amount under any sensible cap, which must still be refused. A per-operation
        limit would sit alongside this function, never replace it.
      </p>
    </div>
  );
}
