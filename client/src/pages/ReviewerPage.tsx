import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../session";
import "./reviewer.css";
import {
  MoneyDefences,
  LockDetails,
  ReplayDetails,
  IdempotencyLayers,
  SecurityDetails,
} from "../components/reviewer/CodeDetails";
import { DocumentLibrary } from "../components/reviewer/DocumentLibrary";

const chapters = [
  ["architecture", "The architecture"],
  ["money", "Money, precisely"],
  ["locking", "Concurrent transfers"],
  ["retries", "Retries & the catch block"],
  ["security", "Security by layer"],
  ["evidence", "Tests & trade-offs"],
  ["documents", "Documents & Q&A"],
] as const;

function Source({ children }: { children: ReactNode }) {
  return (
    <p className="review-source">
      <span>IN THE CODE</span> <code>{children}</code>
    </p>
  );
}

function Chapter({ id, number, title, children }: { id: string; number: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="review-chapter" aria-labelledby={`${id}-title`}>
      <div className="review-chapter-heading">
        <span>{number}</span>
        <h2 id={`${id}-title`}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function LockExplorer() {
  const [ordered, setOrdered] = useState(true);
  return (
    <div className="review-explorer">
      <div className="review-explorer-top">
        <div>
          <span className="review-kicker">CONCURRENCY EXPLAINER</span>
          <h3>Two transfers. Opposite directions.</h3>
        </div>
        <div className="review-switch" aria-label="Account locking strategy">
          <button type="button" aria-pressed={ordered} onClick={() => setOrdered(true)}>
            Ordered locks
          </button>
          <button type="button" aria-pressed={!ordered} onClick={() => setOrdered(false)}>
            Without ordering
          </button>
        </div>
      </div>
      <p>Imagine account A’s UUID sorts before B’s. These are illustrative schedules, not live database requests.</p>
      <div className="review-lock-lanes" aria-live="polite">
        <div>
          <strong>A → B</strong>
          <span className="review-lock">Locks A</span>
          <span className={ordered ? "review-lock" : "review-wait"}>{ordered ? "Locks B" : "Waits for B"}</span>
          <b>{ordered ? "Commits & releases" : "B is held by B → A"}</b>
        </div>
        <div>
          <strong>B → A</strong>
          <span className={ordered ? "review-wait" : "review-lock"}>{ordered ? "Waits for A" : "Locks B"}</span>
          <span className={ordered ? "review-lock" : "review-wait"}>{ordered ? "Then locks A, B" : "Waits for A"}</span>
          <b>{ordered ? "Commits & releases" : "A is held by A → B"}</b>
        </div>
        <p className={ordered ? "review-outcome" : "review-outcome review-outcome-warning"}>
          <strong>
            {ordered
              ? "Waiting is safe. A circular wait is avoided."
              : "A cycle forms. PostgreSQL must abort a transaction."}
          </strong>
          {ordered
            ? " Both transfers acquire account rows in the same UUID order, regardless of which account sends the money. The second proceeds after the first releases its locks."
            : " If each transfer locked its sender first, each could hold the row the other needs. This is the deadlock the implemented ordering prevents."}
        </p>
      </div>
    </div>
  );
}

const retryCases = [
  {
    label: "Same request",
    title: "Return the original receipt",
    text: "The key, operation type, amount, both account IDs and initiating user all match. replayOfTransfer returns the recorded amount and sender balance, plus recipient details. No balances are updated again.",
    result: "200 · Recorded result",
  },
  {
    label: "Changed payload",
    title: "Refuse a different operation",
    text: "The same key arrives with a different amount, recipient, operation type or user. replayOf checks all of these fields and throws IDEMPOTENCY_CONFLICT. It must never confirm an operation that did not happen.",
    result: "409 · Idempotency conflict",
  },
  {
    label: "Insert race",
    title: "Roll back, then resolve the winner",
    text: "The idempotency key is globally unique. Requests using different account locks can both miss the initial lookup and race to insert it. The losing insert raises 23505. After ROLLBACK, the catch block reads the committed record and applies the same strict replay checks. A different user or account pair produces a conflict.",
    result: "23505 → ROLLBACK → lookup → verify",
  },
] as const;

function RetryExplorer() {
  const [selected, setSelected] = useState(0);
  const scenario = retryCases[selected]!;
  return (
    <div className="review-explorer">
      <span className="review-kicker">FOLLOW AN IDEMPOTENCY KEY</span>
      <div className="review-retry-options" aria-label="Retry scenario">
        {retryCases.map((item, index) => (
          <button key={item.label} type="button" aria-pressed={index === selected} onClick={() => setSelected(index)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="review-retry-result" aria-live="polite">
        <span className="review-result-code">{scenario.result}</span>
        <h3>{scenario.title}</h3>
        <p>{scenario.text}</p>
      </div>
    </div>
  );
}

const controls = [
  {
    title: "Passwords are expensive to guess",
    tag: "CREDENTIALS",
    text: "scrypt derives a 32-byte digest with a fresh 16-byte random salt for each password (N = 2¹⁷, r = 8, p = 1; 256 MiB memory cap). The stored encoding includes the parameters. Verification uses timingSafeEqual for equal-length digests.",
    source: "server/src/security/password.ts",
  },
  {
    title: "Sign-in reveals less",
    tag: "AUTHENTICATION",
    text: "Unknown emails and wrong passwords receive the same response. An unknown email is checked against a decoy digest so it still performs scrypt work, reducing a timing signal. Failed attempts are limited to 5 per 15 minutes per normalized email + IP; successful requests do not count.",
    source: "server/src/app.ts · signInLimiter, /api/auth/sign-in",
  },
  {
    title: "A cookie, with revocable server state",
    tag: "SESSIONS",
    text: "Each sign-in creates a random 32-byte token. Only its SHA-256 hash is stored in PostgreSQL. The cookie is HttpOnly, SameSite=Lax and scoped to /. Sign-out deletes the server record and clears the cookie; the client stores no session token in localStorage.",
    source: "server/src/security/session.ts · createSession, destroySession",
  },
  {
    title: "Expiry is enforced by the API",
    tag: "LIFECYCLE",
    text: "Every protected request checks a 10-minute idle timeout and an 8-hour absolute lifetime. Activity timestamps update at most once a minute. The client checks activity every 2 minutes; the server remains authoritative. An indexed sweep removes absolutely expired sessions on startup and every 10 minutes.",
    source: "server/src/security/session.ts · client/src/session.tsx",
  },
  {
    title: "Identity comes from the session",
    tag: "AUTHORIZATION",
    text: "The API supplies authenticatedUser.id to the money module. A caller cannot select a sender by posting someone else’s user ID: strict schemas reject extra fields, and source-account queries use the authenticated user. Account reads are scoped the same way.",
    source: "server/src/app.ts · server/src/money/module.ts",
  },
  {
    title: "State changes require the expected origin",
    tag: "REQUEST ORIGIN",
    text: "POST, PUT, PATCH and DELETE requests must carry an Origin exactly equal to the configured allowed origin. A missing or different Origin is rejected. Together with SameSite cookies, this is the implemented CSRF protection; there is no separate CSRF token.",
    source: "server/src/app.ts · Origin middleware",
  },
  {
    title: "Validate at each boundary",
    tag: "INPUT & SQL",
    text: "Strict Zod schemas validate JSON, UUID operation keys and five-digit account numbers. JSON bodies are capped at 20 KB. The money module parses amounts independently of the browser. SQL values use placeholders, and database checks enforce valid stored shapes.",
    source: "server/src/app.ts · money/amount.ts · 001_initial_schema.sql",
  },
  {
    title: "Limit recipient discovery",
    tag: "TRANSFERS",
    text: "Preview and transfer share a limit of 20 requests per minute per authenticated user. A missing recipient and a self-transfer have the same unavailable response. Amounts are validated before recipient lookup. A valid preview deliberately reveals the recipient’s name for confirmation.",
    source: "server/src/app.ts · transferLimiter · money/module.ts",
  },
  {
    title: "Reduce exposure; keep failures traceable",
    tag: "HTTP & DIAGNOSTICS",
    text: "Helmet configures security headers on Express responses and X-Powered-By is disabled. Each request gets an ID, also returned with errors. Access logs record method, route, status and duration, without logging request bodies. Unexpected errors return a generic message; server logs retain the error.",
    source: "server/src/app.ts · server/src/errors.ts",
  },
];

export function ReviewerPage() {
  const session = useSession();
  useEffect(() => {
    const previous = document.title;
    document.title = "Reviewer guide · Banking App";
    return () => {
      document.title = previous;
    };
  }, []);
  return (
    <div className="reviewer-page">
      <a className="review-skip" href="#review-content">
        Skip to guide
      </a>
      <header className="review-header">
        <Link to="/account" className="wordmark">
          Banking App
          <span className="review-brand-dot" />
        </Link>
        <span className="review-header-label">ENGINEERING / REVIEWER GUIDE</span>
        <Link className="review-back" to={session.status === "authenticated" ? "/account" : "/sign-in"}>
          Open the app <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <div className="review-layout">
        <aside className="review-sidebar">
          <span className="review-kicker">UNDER THE HOOD</span>
          <nav aria-label="Guide chapters">
            {chapters.map(([id, label], index) => (
              <a key={id} href={`#${id}`}>
                <span>0{index + 1}</span>
                {label}
              </a>
            ))}
          </nav>
          <div className="review-sidebar-note">
            <span className="review-status-dot" /> Implementation guide
            <p>
              Follow the request.
              <br />
              Inspect the guarantees.
              <br />
              Explore the trade-offs.
            </p>
          </div>
        </aside>
        <main id="review-content" className="review-content">
          <div className="review-hero">
            <div className="review-hero-label">
              <span className="review-status-dot" /> A SMALL APP, EXPLAINED
            </div>
            <h1>
              Simple banking.
              <br />
              <span>Careful engineering.</span>
            </h1>
            <p>
              A guided look at how the application protects sessions, keeps money exact, and makes concurrent transfers
              safe to retry.
            </p>
            <div className="review-hero-bottom">
              <a href="#architecture">
                Explore the architecture <span aria-hidden="true">↓</span>
              </a>
              <span>React · Express · PostgreSQL</span>
            </div>
          </div>
          <div className="review-principles">
            <div>
              <span>01 / PRECISION</span>
              <strong>Every penny, accounted for.</strong>
              <p>Integer money from input to storage.</p>
            </div>
            <div>
              <span>02 / CONSISTENCY</span>
              <strong>One operation, one commit.</strong>
              <p>Balances and the record move together.</p>
            </div>
            <div>
              <span>03 / TRUST</span>
              <strong>The server has the final say.</strong>
              <p>Identity and validation at the boundary.</p>
            </div>
          </div>

          <Chapter id="architecture" number="01" title="A small system with clear responsibilities.">
            <p className="review-lead">
              The browser owns the journey. Express establishes identity and validates requests. One money module owns
              balance changes, backed by PostgreSQL transactions.
            </p>
            <div
              className="review-architecture"
              aria-label="Request flow from browser through API and money module to PostgreSQL"
            >
              <div>
                <span>01 · PRESENTATION</span>
                <h3>React + Vite</h3>
                <p>Routes, forms, recipient preview and confirmation. Amounts cross the API as strings.</p>
                <code>client/src/</code>
              </div>
              <span className="review-flow-arrow" aria-hidden="true">
                ↓
              </span>
              <div>
                <span>02 · TRUST BOUNDARY</span>
                <h3>Express API</h3>
                <p>Origin check → session → schema validation. The server supplies the acting user’s ID.</p>
                <code>server/src/app.ts</code>
              </div>
              <span className="review-flow-arrow" aria-hidden="true">
                ↓
              </span>
              <div className="review-architecture-core">
                <span>03 · BUSINESS RULES</span>
                <h3>The money module</h3>
                <p>Parse → lock → check replay → validate funds → record & update → commit.</p>
                <code>server/src/money/module.ts</code>
              </div>
              <span className="review-flow-arrow" aria-hidden="true">
                ↓
              </span>
              <div>
                <span>04 · DURABLE STATE</span>
                <h3>PostgreSQL</h3>
                <p>
                  Row locks, uniqueness, foreign keys and check constraints. One client connection per money
                  transaction.
                </p>
                <code>database/migrations/001_initial_schema.sql</code>
              </div>
            </div>
            <div className="review-schema">
              <h3>Four tables, one explicit money boundary</h3>
              <dl>
                <div>
                  <dt>users</dt>
                  <dd>Identity and password digests.</dd>
                </div>
                <div>
                  <dt>sessions</dt>
                  <dd>Many per user; hashed tokens and expiry.</dd>
                </div>
                <div>
                  <dt>accounts</dt>
                  <dd>One per user; a stored balance in pence.</dd>
                </div>
                <div>
                  <dt>money_transactions</dt>
                  <dd>Operation, account references, unique retry key and resulting sender/acting balance.</dd>
                </div>
              </dl>
            </div>
            <p>
              HTTP routes delegate deposits, withdrawals and transfers to <code>createMoneyModule(pool)</code>. This
              keeps transaction mechanics and money rules together instead of repeating them in route handlers. Database
              setup and fixtures live separately in <code>database/scripts/</code>.
            </p>
          </Chapter>

          <Chapter id="money" number="02" title="Money never takes a floating-point detour.">
            <div className="review-money-strip">
              <span>
                Input<strong>"12.34"</strong>
              </span>
              <b aria-hidden="true">→</b>
              <span>
                Application<strong>1234n</strong>
              </span>
              <b aria-hidden="true">→</b>
              <span>
                PostgreSQL<strong>BIGINT</strong>
              </span>
              <b aria-hidden="true">→</b>
              <span>
                JSON response<strong>"1234"</strong>
              </span>
            </div>
            <p>
              Amounts are decimal strings with up to two fractional digits. The server splits pounds and pence, then
              uses <code>BigInt</code> arithmetic. It rejects zero, negatives, exponents, excessive decimal places and
              amounts beyond PostgreSQL’s signed BIGINT range. Credited balances are range-checked too.
            </p>
            <div className="review-two-col">
              <article>
                <h3>One atomic write</h3>
                <p>
                  A transfer inserts its record, debits the sender and credits the recipient inside one transaction.{" "}
                  <code>COMMIT</code> makes them durable together; an error runs <code>ROLLBACK</code>. The connection
                  is released in <code>finally</code>.
                </p>
              </article>
              <article>
                <h3>Checks behind the checks</h3>
                <p>
                  The database requires nonnegative balances, positive amounts and valid deposit/withdrawal/transfer
                  account shapes. Foreign keys preserve references; a transfer cannot name the same source and
                  destination.
                </p>
              </article>
            </div>
            <p className="review-callout">
              <strong>A preview is not a reservation.</strong> Preview checks the amount and recipient, but does not
              lock accounts or check available funds. Confirmation repeats the authoritative checks against locked,
              current balances.
            </p>
            <Source>
              server/src/money/amount.ts · server/src/money/module.ts · database/migrations/001_initial_schema.sql
            </Source>
            <MoneyDefences />
          </Chapter>

          <Chapter id="locking" number="03" title="A shared order prevents a circular wait.">
            <p className="review-lead">
              Two withdrawals must not both spend the same balance. Two opposite transfers must not each hold the lock
              the other is waiting for.
            </p>
            <LockExplorer />
            <div className="review-code">
              <span>THE IMPLEMENTED LOCK QUERY · EXCERPT</span>
              <pre>
                <code>{`WHERE a.id = ANY($1::uuid[])
ORDER BY a.id FOR UPDATE OF a`}</code>
              </pre>
            </div>
            <p>
              <code>FOR UPDATE OF a</code> locks the account rows before balances are read and changed.{" "}
              <code>ORDER BY a.id</code> gives both transfer directions the same acquisition order, using internal UUIDs
              rather than public account numbers. Locks remain held until commit or rollback.
            </p>
            <p>
              Operations sharing an account serialize, so the second checks the balance left by the first. Transfers
              using disjoint accounts can proceed independently. Ordering prevents this opposite-direction deadlock
              pattern; it does not remove contention or claim that every possible database deadlock is impossible.
            </p>
            <Source>server/src/money/module.ts · transfer, lockOwnAccount</Source>
            <LockDetails />
          </Chapter>

          <Chapter id="retries" number="04" title="Retry the request. Reuse the result.">
            <p className="review-lead">
              A response can disappear after the database commits. A UUID idempotency key lets a caller ask again
              without applying the same operation twice.
            </p>
            <RetryExplorer />
            <h3>Why is replayOfTransfer in the catch block?</h3>
            <ol className="review-steps">
              <li>
                <strong>Undo the failed attempt.</strong>
                <p>
                  The catch block runs <code>ROLLBACK</code> first. A failed SQL transaction cannot be used for the
                  recovery query until it is rolled back.
                </p>
              </li>
              <li>
                <strong>Recognize the uniqueness race.</strong>
                <p>
                  PostgreSQL code <code>23505</code> means a unique constraint was violated. The code looks up the
                  submitted idempotency key to see whether a committed operation explains the failure.
                </p>
              </li>
              <li>
                <strong>Verify the entire operation.</strong>
                <p>
                  It resolves the requested account pair, then calls <code>replayOfTransfer</code>. That delegates to{" "}
                  <code>replayOf</code> to compare type, amount, source, destination and user before constructing the
                  response.
                </p>
              </li>
              <li>
                <strong>Return a receipt, or propagate the error.</strong>
                <p>
                  A matching record returns its saved result. A mismatch becomes a 409 conflict. If no record or pair
                  resolves the failure, the original error is thrown. This branch does not execute the transfer again
                  and is not a general deadlock retry.
                </p>
              </li>
            </ol>
            <div className="review-code">
              <span>RECOVERY FLOW · SIMPLIFIED FROM TRANSFER()</span>
              <pre>
                <code>{`catch (error) {
  await client.query("ROLLBACK");
  if (error.code === "23505") {
    // Find the committed operation and resolve account IDs.
    if (existing && requestedAccounts) {
      // Verify every field before returning the receipt.
      return replayOfTransfer(existing, expected);
    }
  }
  throw error;
}`}</code>
              </pre>
            </div>
            <p>
              <strong>The usual retry is handled before any insert.</strong> Matching transfers lock the same accounts,
              so a duplicate normally waits, then finds the first result in the initial lookup. The catch path is a
              second line of defence for races on the globally unique key, including operations on different accounts.
            </p>
            <p className="review-callout">
              <strong>The key has a lifetime.</strong> The confirmation screen keeps one key across retries while
              mounted. Editing or remounting creates a new key, which represents a new operation. The recorded balance
              returned by a replay is the original result, not a fresh account balance.
            </p>
            <Source>
              server/src/money/module.ts · findExisting, replayOf, replayOfTransfer, transfer ·
              client/src/pages/TransferConfirmPage.tsx
            </Source>
            <ReplayDetails />
            <IdempotencyLayers />
          </Chapter>

          <Chapter id="security" number="05" title="Security is a sequence of concrete checks.">
            <p className="review-lead">
              These are the controls implemented in this application, with the mechanism and source location for each.
            </p>
            <div className="review-security-grid">
              {controls.map((control) => (
                <article key={control.tag}>
                  <span className="review-kicker">{control.tag}</span>
                  <h3>{control.title}</h3>
                  <p>{control.text}</p>
                  <Source>{control.source}</Source>
                </article>
              ))}
            </div>
            <p className="review-callout">
              <strong>Local HTTP is an explicit boundary.</strong> The session cookie currently has{" "}
              <code>secure: false</code> and HSTS is disabled. Helmet runs on Express API responses; Vite serves the
              frontend separately in development. A production deployment needs HTTPS, Secure cookies and appropriate
              frontend/edge headers.
            </p>
            <SecurityDetails />
          </Chapter>

          <Chapter id="evidence" number="06" title="Inspect the guarantees. Know the limits.">
            <p className="review-lead">
              The tests exercise real PostgreSQL behavior for transactions and concurrency. The examples below identify
              existing coverage, rather than claiming that every failure mode is tested.
            </p>
            <div className="review-table-wrap">
              <table className="review-table">
                <thead>
                  <tr>
                    <th>Behavior under test</th>
                    <th>Where to look</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      Concurrent withdrawals cannot jointly overdraw; opposite transfers complete without deadlock.
                    </td>
                    <td>
                      <code>server/src/app.integration.test.ts</code>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      Simultaneous duplicate transfers move money once; changed payloads conflict; recipient overflow is
                      refused.
                    </td>
                    <td>
                      <code>server/src/transfers.integration.test.ts</code>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      Session rejection, origin checks, failed sign-in throttling and database transaction-shape
                      constraints.
                    </td>
                    <td>
                      <code>server/src/app.integration.test.ts</code>
                    </td>
                  </tr>
                  <tr>
                    <td>Exact amount parsing, form validation and transfer retry behavior.</td>
                    <td>
                      <code>server/src/money/amount.test.ts</code>
                      <br />
                      <code>client/src/transfer.test.tsx</code>
                      <br />
                      <code>client/src/money.test.ts</code>
                    </td>
                  </tr>
                  <tr>
                    <td>Deposit, withdrawal, transfer receipt and declined transfer journeys in the browser.</td>
                    <td>
                      <code>e2e/banking.spec.ts</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <h3 className="review-tradeoffs-title">Deliberate scope & next steps</h3>
            <div className="review-tradeoffs">
              <div>
                <strong>Stored balances</strong>
                <p>
                  Balance and transaction record are written together. This is a demo transaction history model, not a
                  double-entry accounting ledger or reconciliation system.
                </p>
              </div>
              <div>
                <strong>Small product surface</strong>
                <p>
                  One GBP account per user, seeded demo identities and simulated deposits/withdrawals. No registration,
                  MFA, password recovery or external payment integration.
                </p>
              </div>
            </div>
            <Source>
              server/src/app.integration.test.ts · server/src/transfers.integration.test.ts ·
              client/src/transfer.test.tsx
            </Source>
          </Chapter>
          <Chapter id="documents" number="07" title="The decisions behind the implementation.">
            <DocumentLibrary />
          </Chapter>
          <footer className="review-end">
            <span className="review-kicker">READY TO EXPLORE?</span>
            <h2>See the decisions in action.</h2>
            <Link className="primary-button" to={session.status === "authenticated" ? "/account" : "/sign-in"}>
              Open Banking App <span aria-hidden="true">↗</span>
            </Link>
            <a href="#review-content">Back to top ↑</a>
          </footer>
        </main>
      </div>
    </div>
  );
}
