import { Route, Router } from "@solidjs/router";
import { render } from "solid-js/web";
import { Overview } from "../../src/features/overview/Overview";
import EmailCodeRoute from "../../src/routes/auth/code";
import LoginRoute from "../../src/routes/login";
import { connectFixtureProject, fixtureSession } from "./project-fixture";
import "../../src/styles/global.css";

const authDependencies = {
  googleAuthConfigured: true,
  async humanSession() {
    return null;
  },
  async requestEmailOtp(email: string) {
    if (email === "rate@example.test") throw { status: 429 };
    if (email === "server@example.test") throw { status: 503 };
  },
  async startGoogleSignIn(callbackURL: string) {
    document.documentElement.dataset.fixtureGoogleCallback = callbackURL;
  },
  async verifyEmailOtp(_email: string, otp: string) {
    if (otp === "ABC123") return;
    if (otp === "EXP123") throw { code: "OTP_EXPIRED" };
    throw { code: "INVALID_OTP" };
  },
  resendCooldownSeconds: 0,
};

function FixtureOverview() {
  return (
    <Overview
      orgSlug="fixture-studio"
      projectSlug="dongo"
      connect={connectFixtureProject}
      loadSession={fixtureSession}
    />
  );
}

function FixtureLogin() {
  return <LoginRoute dependencies={authDependencies} />;
}

function FixtureEmailCode() {
  return <EmailCodeRoute dependencies={authDependencies} />;
}

function FixtureAuthCallback() {
  return (
    <main>
      <h1>Fixture authentication complete</h1>
    </main>
  );
}

const root = document.getElementById("app");
if (!root) throw new Error("E2E fixture root is unavailable");

render(
  () => (
    <Router>
      <Route path="/login" component={FixtureLogin} />
      <Route path="/auth/code" component={FixtureEmailCode} />
      <Route path="/auth/callback" component={FixtureAuthCallback} />
      <Route path="*" component={FixtureOverview} />
    </Router>
  ),
  root,
);
