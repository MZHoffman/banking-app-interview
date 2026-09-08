import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "./session";
import { lazy, Suspense } from "react";
import { AccountPage } from "./pages/AccountPage";
import { OperationPage } from "./pages/OperationPage";
import { SessionExpiredPage } from "./pages/SessionExpiredPage";
import { SignInPage } from "./pages/SignInPage";
import { TransferConfirmPage } from "./pages/TransferConfirmPage";
import { TransferPage } from "./pages/TransferPage";

const ReviewerPage = lazy(() => import("./pages/ReviewerPage").then((module) => ({ default: module.ReviewerPage })));

function Protected({ children }: { children: React.ReactNode }) {
  const session = useSession();
  if (session.status === "loading") return <main className="loading-screen">Loading Banking App...</main>;
  if (session.status === "expired") return <Navigate to="/session-expired" replace />;
  if (session.status !== "authenticated") return <Navigate to="/sign-in" replace />;
  return children;
}

export function App() {
  return (
    <>
      <Routes>
        <Route
          path="/reviewer-guide"
          element={
            <Suspense fallback={<main className="loading-screen">Loading reviewer guide...</main>}>
              <ReviewerPage />
            </Suspense>
          }
        />
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/session-expired" element={<SessionExpiredPage />} />
        <Route
          path="/account"
          element={
            <Protected>
              <AccountPage />
            </Protected>
          }
        />
        <Route
          path="/account/deposit"
          element={
            <Protected>
              <OperationPage type="deposit" />
            </Protected>
          }
        />
        <Route
          path="/account/withdraw"
          element={
            <Protected>
              <OperationPage type="withdrawal" />
            </Protected>
          }
        />
        <Route
          path="/account/transfer"
          element={
            <Protected>
              <TransferPage />
            </Protected>
          }
        />
        <Route
          path="/account/transfer/confirm"
          element={
            <Protected>
              <TransferConfirmPage />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/account" replace />} />
      </Routes>
      <Link className="reviewer-guide-link" to="/reviewer-guide">
        <span aria-hidden="true">↗</span> Reviewer guide
      </Link>
    </>
  );
}
