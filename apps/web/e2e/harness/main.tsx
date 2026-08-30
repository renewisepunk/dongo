import { Route, Router } from "@solidjs/router";
import { render } from "solid-js/web";
import { Overview } from "../../src/features/overview/Overview";
import AuthCallbackRoute from "../../src/routes/auth/callback";
import EmailCodeRoute from "../../src/routes/auth/code";
import DeviceAuthorizationRoute from "../../src/routes/device";
import LoginRoute from "../../src/routes/login";
import OnboardingRoute from "../../src/routes/onboarding";
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

const authCallbackDependencies = {
  async consumeCrossDomainOneTimeToken() {
    if (new URLSearchParams(window.location.search).get("scenario") === "token-error") {
      throw new Error("fixture token detail must stay hidden");
    }
  },
  async humanSession() {
    return new URLSearchParams(window.location.search).get("scenario") === "missing-session"
      ? null
      : fixtureSession();
  },
  async bootstrapHumanIdentity() {
    if (new URLSearchParams(window.location.search).get("scenario") === "bootstrap-error") {
      throw new Error("fixture bootstrap detail must stay hidden");
    }
  },
  async bridgeAuthorizationSession(returnTo: string) {
    if (new URLSearchParams(window.location.search).get("scenario") === "invalid-bridge") {
      return "https://evil.example/steal";
    }
    const destination = new URL(returnTo, window.location.origin);
    destination.searchParams.set("bridged", "1");
    return `${destination.pathname}${destination.search}`;
  },
  async listAuthorizableProjects() {
    return new URLSearchParams(window.location.search).get("scenario") === "no-project"
      ? []
      : [{
          id: "project-fixture",
          publicRef: "fixture-project",
          name: "Dongo",
          slug: "dongo",
          organizationName: "Fixture Studio",
          organizationSlug: "fixture-studio",
        }];
  },
  assignLocation(href: string) {
    window.location.assign(href);
  },
};

const onboardingDependencies = {
  async humanSession() {
    return new URLSearchParams(window.location.search).get("scenario") === "missing-session"
      ? null
      : {
          user: {
            id: "user-fixture",
            name: "Fixture Owner",
            email: "fixture@example.test",
          },
        };
  },
  async bootstrapHumanIdentity() {
    if (new URLSearchParams(window.location.search).get("scenario") === "session-error") {
      throw new Error("fixture session detail must stay hidden");
    }
  },
  async createFirstProject(input: {
    name: string;
    slug: string;
    repositoryUrl?: string;
    executionMode: "manual" | "autonomous";
  }) {
    if (input.name === "Fail safely") {
      throw new Error("fixture provisioning detail must stay hidden");
    }
    return {
      projectId: "project-created",
      publicRef: "fixture-created",
      created: true,
      resourceProvisioned: true as const,
      organizationId: "organization-fixture",
      organizationSlug: "fixture-owner-serfixture",
    };
  },
};

const deviceDependencies = {
  async humanSession() {
    const code = new URLSearchParams(window.location.search).get("user_code")?.replace(/-/g, "");
    return code === "NOSSN000"
      ? null
      : { user: { name: "Fixture Owner", email: "fixture@example.test" } };
  },
  async bridgeAuthorizationSession(returnTo: string) {
    document.documentElement.dataset.fixtureDeviceBridge = returnTo;
    return returnTo;
  },
  async getDeviceRequest(userCode: string) {
    if (userCode === "ERROR001") throw new Error("fixture request detail must stay hidden");
    return {
      userCode,
      status: userCode === "USED0001" ? "approved" : "pending",
      clientId: "dongo-cli",
      scopes: ["dongo:work:read", "dongo:work:write", "offline_access"],
      resources: ["https://dev.dongo.so/api/agent/v1"],
    };
  },
  async listAuthorizableProjects() {
    const code = new URLSearchParams(window.location.search).get("user_code")?.replace(/-/g, "");
    return code === "NOPROJ00"
      ? []
      : [
          {
            publicRef: "fixture-project",
            name: "Dongo",
            slug: "dongo",
            organizationName: "Fixture Studio",
            organizationSlug: "fixture-studio",
          },
          {
            publicRef: "companion-project",
            name: "Companion",
            slug: "companion",
            organizationName: "Fixture Studio",
            organizationSlug: "fixture-studio",
          },
        ];
  },
  async selectAuthorizationProject(publicRef: string, returnTo: string) {
    document.documentElement.dataset.fixtureDeviceProject = JSON.stringify({ publicRef, returnTo });
  },
  async decideDeviceRequest(userCode: string, accept: boolean) {
    document.documentElement.dataset.fixtureDeviceDecision = JSON.stringify({ userCode, accept });
  },
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
  return <AuthCallbackRoute dependencies={authCallbackDependencies} />;
}

const root = document.getElementById("app");
if (!root) throw new Error("E2E fixture root is unavailable");

render(
  () => (
    <Router>
      <Route path="/login" component={FixtureLogin} />
      <Route path="/auth/code" component={FixtureEmailCode} />
      <Route path="/auth/callback" component={FixtureAuthCallback} />
      <Route path="/onboarding" component={() => <OnboardingRoute dependencies={onboardingDependencies} />} />
      <Route path="/device" component={() => <DeviceAuthorizationRoute dependencies={deviceDependencies} />} />
      <Route path="*" component={FixtureOverview} />
    </Router>
  ),
  root,
);
