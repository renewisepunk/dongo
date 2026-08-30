import { Route, Router } from "@solidjs/router";
import { render } from "solid-js/web";
import { Overview, type OverviewConnection } from "../../src/features/overview/Overview";
import { ProjectSettings } from "../../src/features/admin/ProjectSettings";
import type { WorkItem } from "../../src/features/overview/model";
import { CompletedWork } from "../../src/routes/app/[orgSlug]/[projectSlug]/done";
import AuthCallbackRoute from "../../src/routes/auth/callback";
import EmailCodeRoute from "../../src/routes/auth/code";
import ConnectRoute from "../../src/routes/connect";
import DeviceAuthorizationRoute from "../../src/routes/device";
import LoginRoute from "../../src/routes/login";
import OnboardingRoute from "../../src/routes/onboarding";
import OAuthConsentRoute from "../../src/routes/oauth/consent";
import OAuthProjectRoute from "../../src/routes/oauth/project";
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
          name: "dongo",
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
      : { user: { id: "user-fixture", name: "Fixture Owner", email: "fixture@example.test" } };
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
    if (code === "NOPROJ00") return [];
    return [
      {
        publicRef: "fixture-project",
        name: "dongo",
        slug: "dongo",
        organizationName: "Fixture Studio",
        organizationSlug: "fixture-studio",
        repositoryUrl: "https://github.com/renewisepunk/dongo",
      },
      {
        publicRef: "companion-project",
        name: "Companion",
        slug: "companion",
        organizationName: "Fixture Studio",
        organizationSlug: "fixture-studio",
        repositoryUrl: "https://github.com/renewisepunk/companion",
      },
    ];
  },
  async createFirstProject(input: {
    user: { id: string; name?: string; email?: string };
    name: string;
    slug: string;
    repositoryUrl?: string;
    executionMode: "manual" | "autonomous";
  }) {
    document.documentElement.dataset.fixtureDeviceCreatedProject = JSON.stringify(input);
    return {
      projectId: "project-created",
      publicRef: "fixture-created",
      created: true,
      resourceProvisioned: true as const,
      organizationId: "organization-fixture",
      organizationSlug: "fixture-owner-serfixture",
    };
  },
  async selectAuthorizationProject(publicRef: string, returnTo: string) {
    document.documentElement.dataset.fixtureDeviceProject = JSON.stringify({ publicRef, returnTo });
  },
  async decideDeviceRequest(userCode: string, accept: boolean) {
    document.documentElement.dataset.fixtureDeviceDecision = JSON.stringify({ userCode, accept });
  },
};

const oauthProjects = [
  {
    publicRef: "fixture-project",
    name: "dongo",
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

function oauthScenario(): string | null {
  return new URLSearchParams(window.location.search).get("scenario");
}

const oauthProjectDependencies = {
  async humanSession() {
    return oauthScenario() === "missing-session" ? null : { user: { id: "fixture" } };
  },
  async bridgeAuthorizationSession(returnTo: string) {
    document.documentElement.dataset.fixtureOauthBridge = returnTo;
    return returnTo;
  },
  async listAuthorizableProjects() {
    if (oauthScenario() === "project-error") {
      throw new Error("fixture project detail must stay hidden");
    }
    return oauthScenario() === "no-project" ? [] : oauthProjects;
  },
  async selectAuthorizationProject(publicRef: string, returnTo: string) {
    document.documentElement.dataset.fixtureOauthProject = JSON.stringify({ publicRef, returnTo });
  },
  async continueOAuthAfterProject(search: string) {
    document.documentElement.dataset.fixtureOauthContinue = search;
    return { redirect: true, url: "/oauth/consent?fixture=continued" };
  },
  followOAuthResult(result: { redirect?: boolean; url?: string }) {
    document.documentElement.dataset.fixtureOauthFollow = JSON.stringify(result);
  },
};

const oauthConsentDependencies = {
  async humanSession() {
    return oauthScenario() === "missing-session"
      ? null
      : { user: { name: "Fixture Owner", email: "fixture@example.test" } };
  },
  async bridgeAuthorizationSession(returnTo: string) {
    document.documentElement.dataset.fixtureConsentBridge = returnTo;
    return returnTo;
  },
  async getOAuthClientSummary(clientId: string) {
    if (oauthScenario() === "client-error") {
      throw new Error("fixture client detail must stay hidden");
    }
    return { clientId, name: clientId === "claude" ? "Claude Code" : "Codex" };
  },
  async listAuthorizableProjects() {
    return oauthScenario() === "no-project" ? [] : oauthProjects;
  },
  async selectAuthorizationProject(publicRef: string, returnTo: string) {
    document.documentElement.dataset.fixtureConsentProject = JSON.stringify({ publicRef, returnTo });
  },
  async decideOAuthConsent(search: string, accept: boolean) {
    document.documentElement.dataset.fixtureConsentDecision = JSON.stringify({ search, accept });
    return { redirect: true, url: "/fixture/oauth-complete" };
  },
  followOAuthResult(result: { redirect?: boolean; url?: string }) {
    document.documentElement.dataset.fixtureConsentFollow = JSON.stringify(result);
  },
};

const connectDependencies = {
  async humanSession() {
    return oauthScenario() === "missing-session" ? null : { user: { id: "fixture" } };
  },
  async bootstrapHumanIdentity() {
    if (oauthScenario() === "session-error") {
      throw new Error("fixture connect session detail must stay hidden");
    }
  },
  async connectFirst(preferredProjectId?: string) {
    document.documentElement.dataset.fixtureConnectPreferredProject = preferredProjectId ?? "none";
    if (oauthScenario() === "connect-error") {
      throw new Error("fixture connection detail must stay hidden");
    }
    return {
      project: {
        id: "project-fixture",
        name: "dongo",
        slug: "dongo",
        publicRef: "fixture-project",
        organizationName: "Fixture Studio",
        organizationSlug: "fixture-studio",
        organizationPlan: "paid" as const,
        membershipRole: "owner" as const,
        activeProjectCount: 1,
        identifierPrefix: "DONGO",
        executionMode: "manual" as const,
      },
      subscribeInstallations(
        onUpdate: (installations: Array<{
          id: string;
          kind: "cli" | "mcp" | "service" | "development";
          status: "pending" | "active" | "needs_reauth" | "revoked";
          clientId: string;
          label: string;
          machineLabel?: string;
          scopes: string[];
          createdAt: number;
          lastUsedAt?: number;
        }>) => void,
        onError: (error: Error) => void,
      ) {
        if (oauthScenario() === "status-error") {
          onError(new Error("fixture status detail must stay hidden"));
        } else {
          onUpdate(oauthScenario() === "connected"
            ? [{
                id: "installation-fixture",
                kind: "cli",
                status: "active",
                clientId: "dongo-cli",
                label: "dongo CLI",
                machineLabel: "Fixture Mac",
                scopes: ["dongo:work:read", "dongo:work:write"],
                createdAt: Date.now(),
              }]
            : []);
        }
        return () => {
          document.documentElement.dataset.fixtureConnectUnsubscribed = "true";
        };
      },
      async close() {
        document.documentElement.dataset.fixtureConnectClosed = "true";
      },
    };
  },
  async writeClipboard(value: string) {
    if (oauthScenario() === "copy-error") {
      throw new Error("fixture clipboard detail must stay hidden");
    }
    document.documentElement.dataset.fixtureClipboard = value;
  },
};

function fixtureAdministration() {
  const memberRole = oauthScenario() === "member";
  const archived = oauthScenario() === "archived";
  return {
    project: {
      name: "dongo",
      slug: "dongo",
      repositoryUrl: "https://github.com/renewisepunk/dongo",
      identifierPrefix: "DONGO",
      executionMode: "manual" as const,
      ...(archived ? { archivedAt: Date.now() - 60_000 } : {}),
    },
    organization: {
      name: "Fixture Studio",
      slug: "fixture-studio",
      plan: memberRole ? "free" as const : "paid" as const,
    },
    membershipRole: memberRole ? "member" as const : "owner" as const,
    members: [
      {
        membershipId: "membership-owner",
        profileId: "profile-owner",
        name: "Fixture Owner",
        email: "owner@example.test",
        role: "owner" as const,
        joinedAt: Date.now() - 86_400_000,
        current: !memberRole,
      },
      {
        membershipId: "membership-member",
        profileId: "profile-member",
        name: "Fixture Member",
        email: "member@example.test",
        role: "member" as const,
        joinedAt: Date.now() - 3_600_000,
        current: memberRole,
      },
    ],
    activeProjectCount: 1,
    storage: {
      activeBytes: 1_572_864,
      reservedBytes: 524_288,
      limitBytes: 10_737_418_240,
      maximumAttachmentBytes: 262_144_000,
    },
  };
}

const settingsDependencies = {
  async connectForSettings(orgSlug: string, projectSlug: string) {
    document.documentElement.dataset.fixtureSettingsTarget = `${orgSlug}/${projectSlug}`;
    if (oauthScenario() === "load-error") {
      throw new Error("fixture settings detail must stay hidden");
    }
    const administration = fixtureAdministration();
    const project = {
      id: "project-fixture",
      name: administration.project.name,
      slug: administration.project.slug,
      publicRef: "fixture-project",
      organizationName: administration.organization.name,
      organizationSlug: administration.organization.slug,
      organizationPlan: administration.organization.plan,
      membershipRole: administration.membershipRole,
      activeProjectCount: administration.activeProjectCount,
      repositoryUrl: administration.project.repositoryUrl,
      identifierPrefix: administration.project.identifierPrefix,
      executionMode: administration.project.executionMode,
      ...(administration.project.archivedAt === undefined
        ? {}
        : { archivedAt: administration.project.archivedAt }),
    };
    const installations = [
      {
        id: "installation-cli",
        kind: "cli" as const,
        status: "active" as const,
        clientId: "dongo-cli",
        label: "dongo CLI",
        machineLabel: "Fixture Mac",
        scopes: ["dongo:work:read", "dongo:work:write"],
        createdAt: Date.now() - 3_600_000,
        lastUsedAt: Date.now(),
      },
      {
        id: "installation-revoked",
        kind: "mcp" as const,
        status: "revoked" as const,
        clientId: "claude",
        label: "Claude Code",
        scopes: ["dongo:work:read"],
        createdAt: Date.now() - 86_400_000,
      },
    ];
    return {
      project,
      async getAdministration() {
        return structuredClone(administration);
      },
      subscribeInstallations(
        onUpdate: (value: typeof installations) => void,
        onError: (error: Error) => void,
      ) {
        if (oauthScenario() === "installation-error") {
          onError(new Error("fixture installation detail must stay hidden"));
        } else {
          onUpdate(installations);
        }
        return () => {
          document.documentElement.dataset.fixtureSettingsUnsubscribed = "true";
        };
      },
      async updateProject(input: {
        name: string;
        repositoryUrl?: string;
        executionMode: "manual" | "autonomous";
      }) {
        if (input.name === "Fail safely") throw new Error("fixture update detail must stay hidden");
        Object.assign(administration.project, input);
        Object.assign(project, input);
        document.documentElement.dataset.fixtureProjectUpdate = JSON.stringify(input);
      },
      async updateOrganization(name: string) {
        if (name === "Fail safely") throw new Error("fixture organization detail must stay hidden");
        administration.organization.name = name;
        project.organizationName = name;
        document.documentElement.dataset.fixtureOrganizationUpdate = name;
      },
      async revokeInstallation(installationId: string) {
        if (oauthScenario() === "mutation-error") throw new Error("fixture revoke detail must stay hidden");
        document.documentElement.dataset.fixtureRevokedInstallation = installationId;
      },
      async createServiceCredential(input: { label: string; scopes: string[] }) {
        document.documentElement.dataset.fixtureServiceCredential = JSON.stringify(input);
        return {
          installationId: "installation-service",
          serviceCredentialId: "credential-fixture",
          tokenPrefix: "dongo_ci_fixture",
          token: "fixture-ci-token-not-secret",
        };
      },
      async removeMember(membershipId: string) {
        administration.members = administration.members.filter(
          (member) => member.membershipId !== membershipId,
        );
        document.documentElement.dataset.fixtureRemovedMember = membershipId;
      },
      async addMember(email: string) {
        document.documentElement.dataset.fixtureAddedMember = email;
        const created = email !== "member@example.test";
        if (created) {
          administration.members.push({
            membershipId: "membership-added",
            profileId: "profile-added",
            name: "Added Member",
            email,
            role: "member",
            joinedAt: Date.now(),
            current: false,
          });
        }
        return { created };
      },
      async archive() {
        document.documentElement.dataset.fixtureArchivedProject = "true";
        administration.project.archivedAt = Date.now();
        project.archivedAt = administration.project.archivedAt;
      },
      async unarchive() {
        delete administration.project.archivedAt;
        delete project.archivedAt;
        document.documentElement.dataset.fixtureRestoredProject = "true";
      },
      async close() {
        document.documentElement.dataset.fixtureSettingsClosed = "true";
      },
    };
  },
  async writeClipboard(value: string) {
    if (oauthScenario() === "copy-error") throw new Error("fixture copy detail must stay hidden");
    document.documentElement.dataset.fixtureSettingsClipboard = value;
  },
};

const firstCompletedPage: WorkItem[] = [
  {
    id: "work-done",
    identifier: "DONGO-6",
    title: "Complete the agent golden journey",
    state: "done",
    agent: "Codex",
    completedAt: "1h",
    goal: "Prove the live agent-first workflow.",
    rank: 100,
    revision: 7,
  },
  {
    id: "work-completed-1",
    identifier: "DONGO-5",
    title: "Freeze the operation contract",
    state: "done",
    agent: "Claude",
    completedAt: "2h",
    goal: "Keep every agent surface on one contract.",
    rank: 200,
    revision: 4,
  },
];

const secondCompletedPage: WorkItem[] = [
  firstCompletedPage[1]!,
  {
    id: "work-completed-2",
    identifier: "DONGO-4",
    title: "Verify tenant isolation",
    state: "done",
    agent: "Codex",
    completedAt: "3h",
    goal: "Prove cross-project access fails closed.",
    rank: 300,
    revision: 5,
  },
];

const completedDependencies = {
  async connect(orgSlug: string, projectSlug: string) {
    document.documentElement.dataset.fixtureCompletedTarget = `${orgSlug}/${projectSlug}`;
    if (oauthScenario() === "completed-connect-error") {
      throw new Error("fixture completed connection detail must stay hidden");
    }
    let listCalls = 0;
    return {
      async listCompleted(cursor: string | null = null) {
        listCalls += 1;
        if (oauthScenario() === "completed-retry" && listCalls === 1) {
          throw new Error("fixture completed retry detail must stay hidden");
        }
        if (cursor && oauthScenario() === "completed-more-error") {
          throw new Error("fixture completed pagination detail must stay hidden");
        }
        if (oauthScenario() === "completed-empty") {
          return { items: [] };
        }
        return cursor
          ? { items: structuredClone(secondCompletedPage) }
          : { items: structuredClone(firstCompletedPage), nextCursor: "completed-next" };
      },
      async close() {
        document.documentElement.dataset.fixtureCompletedClosed = "true";
      },
    };
  },
};

function FixtureOverview() {
  return (
    <Overview
      orgSlug="fixture-studio"
      projectSlug="dongo"
      connect={async (orgSlug, projectSlug): Promise<OverviewConnection> => {
        if (oauthScenario() === "overview-connect-error") {
          throw new Error("fixture overview connection detail must stay hidden");
        }
        const connected = await connectFixtureProject(orgSlug, projectSlug);
        if (oauthScenario() !== "overview-subscription-error") return connected;
        return {
          ...connected,
          subscribeOverview(_onUpdate, onError) {
            queueMicrotask(() => onError(new Error(
              "fixture overview subscription detail must stay hidden",
            )));
            return () => undefined;
          },
        };
      }}
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
      <Route path="/oauth/project" component={() => <OAuthProjectRoute dependencies={oauthProjectDependencies} />} />
      <Route path="/oauth/consent" component={() => <OAuthConsentRoute dependencies={oauthConsentDependencies} />} />
      <Route path="/connect" component={() => <ConnectRoute dependencies={connectDependencies} />} />
      <Route
        path="/app/:orgSlug/:projectSlug/settings"
        component={() => (
          <ProjectSettings
            orgSlug="fixture-studio"
            projectSlug="dongo"
            dependencies={settingsDependencies}
          />
        )}
      />
      <Route
        path="/app/:orgSlug/:projectSlug/done"
        component={() => (
          <CompletedWork
            orgSlug="fixture-studio"
            projectSlug="dongo"
            dependencies={completedDependencies}
          />
        )}
      />
      <Route path="*" component={FixtureOverview} />
    </Router>
  ),
  root,
);
