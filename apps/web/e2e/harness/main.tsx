import { Route, Router } from "@solidjs/router";
import { MetaProvider } from "@solidjs/meta";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { Overview, type OverviewConnection } from "../../src/features/overview/Overview";
import { HelpGuide } from "../../src/features/help/HelpGuide";
import { GetStartedGuide } from "../../src/features/public-guides/GetStartedGuide";
import { PublicHelpGuide } from "../../src/features/public-guides/PublicHelpGuide";
import { PublicChangelog } from "../../src/features/public-guides/PublicChangelog";
import { SecurityOverview } from "../../src/features/security/SecurityOverview";
import { ProjectSettings } from "../../src/features/admin/ProjectSettings";
import { UpgradePlan } from "../../src/features/admin/UpgradePlan";
import { PlatformAdmin } from "../../src/features/admin/PlatformAdmin";
import { ChangelogPublisher, type PublishableWorkRow } from "../../src/features/admin/ChangelogPublisher";
import type {
  PlatformAdminConnection,
  PlatformDashboard,
} from "../../src/lib/platform-data";
import { Ideas } from "../../src/features/ideas/Ideas";
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
import OpenRoute from "../../src/routes/open";
import IndexRoute from "../../src/routes/index";
import { connectFixtureProject, fixtureSession } from "./project-fixture";
import { connectFixtureIdeas } from "./ideas-fixture";
import "../../src/styles/global.css";

const authDependencies = {
  googleAuthConfigured: true,
  async humanSession() {
    document.documentElement.dataset.fixtureHumanSessionChecked = "true";
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
  async getProjectCreationContext() {
    const scenario = new URLSearchParams(window.location.search).get("scenario");
    if (scenario === "allowance-error") {
      throw new Error("fixture allowance detail must stay hidden");
    }
    if (scenario === "paid" || scenario === "free-limit" || scenario === "free-override" || scenario === "member-only") {
      return {
        organizations: scenario === "member-only" ? [] : [{
          id: "organization-fixture",
          name: "Fixture Studio",
          slug: "fixture-studio",
          plan: scenario === "paid" ? "paid" as const : "free" as const,
          activeProjectCount: 1,
          activeProjectLimit: scenario === "paid" ? null : scenario === "free-override" ? 4 : 1,
          projectCapacitySource: scenario === "free-override" ? "operator_override" as const : "plan" as const,
          canCreate: scenario === "paid" || scenario === "free-override",
        }],
        projects: [{
          publicRef: "fixture-project",
          name: "dongo",
          slug: "dongo",
          organizationName: "Fixture Studio",
          organizationSlug: "fixture-studio",
          repositoryUrl: "https://github.com/renewisepunk/dongo",
        }],
      };
    }
    return { organizations: [], projects: [] };
  },
  async createFirstProject(input: {
    organizationId?: string;
    organizationName?: string;
    name: string;
    slug: string;
    repositoryUrl?: string;
    executionMode: "manual" | "autonomous";
    parallelExecution?: {
      enabled: boolean;
      maxConcurrentRuns: number;
      requiresIsolatedWorkspaces: true;
    };
  }) {
    if (input.name === "Fail safely") {
      throw new Error("fixture provisioning detail must stay hidden");
    }
    document.documentElement.dataset.fixtureOnboardingProject = JSON.stringify(input);
    return {
      projectId: "project-created",
      publicRef: "fixture-created",
      created: true,
      resourceProvisioned: true as const,
      organizationId: input.organizationId ?? "organization-fixture",
      organizationSlug: input.organizationId
        ? "fixture-studio"
        : input.organizationName?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "personal-workspace",
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
  async getProjectCreationContext() {
    const code = new URLSearchParams(window.location.search).get("user_code")?.replace(/-/g, "");
    if (code === "NOPROJ00") return { organizations: [], projects: [] };
    const freeLimit = code === "LIMIT001";
    const freeOverride = code === "OVRD0001";
    return {
      organizations: [{
        id: "organization-fixture",
        name: "Fixture Studio",
        slug: "fixture-studio",
        plan: freeLimit || freeOverride ? "free" as const : "paid" as const,
        activeProjectCount: freeLimit ? 1 : 2,
        activeProjectLimit: freeLimit ? 1 : freeOverride ? 5 : null,
        projectCapacitySource: freeOverride ? "operator_override" as const : "plan" as const,
        canCreate: !freeLimit,
      }],
      projects: [
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
      ],
    };
  },
  async createFirstProject(input: {
    user: { id: string; name?: string; email?: string };
    organizationId?: string;
    organizationName?: string;
    name: string;
    slug: string;
    repositoryUrl?: string;
    executionMode: "manual" | "autonomous";
    parallelExecution?: {
      enabled: boolean;
      maxConcurrentRuns: number;
      requiresIsolatedWorkspaces: true;
    };
  }) {
    document.documentElement.dataset.fixtureDeviceCreatedProject = JSON.stringify(input);
    return {
      projectId: "project-created",
      publicRef: "fixture-created",
      created: true,
      resourceProvisioned: true as const,
      organizationId: "organization-fixture",
      organizationSlug: input.organizationName
        ? input.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
        : "fixture-studio",
    };
  },
  async selectAuthorizationProject(publicRef: string, returnTo: string) {
    document.documentElement.dataset.fixtureDeviceProject = JSON.stringify({ publicRef, returnTo });
  },
  async preauthorizeMcpHost(input: {
    projectRef: string;
    userCode: string;
    host: "codex";
    returnTo: string;
  }) {
    document.documentElement.dataset.fixtureDeviceHost = JSON.stringify(input);
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
    return {
      clientId,
      name: clientId === "claude"
        ? "Claude Code"
        : clientId === "legacy-dongo-client"
          ? ["D", "ONGO agent"].join("")
          : "Codex",
    };
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
        activeProjectLimit: null,
        projectCapacitySource: "plan" as const,
        canCreateProject: true,
        identifierPrefix: "DONGO",
        executionMode: "manual" as const,
        parallelExecution: {
          enabled: false,
          maxConcurrentRuns: 1,
          requiresIsolatedWorkspaces: true as const,
        },
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
          const cliInstallation = {
                id: "installation-fixture",
                kind: "cli" as const,
                status: "active" as const,
                clientId: "dongo-cli",
                label: "dongo CLI",
                machineLabel: "Fixture Mac",
                scopes: ["dongo:work:read", "dongo:work:write"],
                createdAt: Date.now(),
              };
          const claudeInstallation = {
            id: "installation-claude",
            kind: "mcp" as const,
            status: oauthScenario() === "claude-connected" || oauthScenario() === "claude-approved"
              ? "active" as const
              : oauthScenario() === "claude-needs-reauth"
                ? "needs_reauth" as const
                : "revoked" as const,
            clientId: "claude-code",
            label: "Claude Code",
            scopes: ["dongo:work:read", "dongo:work:write"],
            createdAt: Date.now(),
            ...(oauthScenario() === "claude-connected" ? { lastUsedAt: Date.now() } : {}),
          };
          if (oauthScenario() === "connected") onUpdate([cliInstallation]);
          else if (oauthScenario() === "claude-connected" || oauthScenario() === "claude-approved" || oauthScenario() === "claude-needs-reauth" || oauthScenario() === "claude-revoked") {
            onUpdate([cliInstallation, claudeInstallation]);
          } else onUpdate([]);
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
  const freeLimitOwner = oauthScenario() === "free-limit-owner";
  const freePlan = memberRole || freeLimitOwner || oauthScenario() === "capacity-override";
  return {
    project: {
      name: "dongo",
      slug: "dongo",
      repositoryUrl: "https://github.com/renewisepunk/dongo",
      identifierPrefix: "DONGO",
      compactIdentifierPrefix: "dong",
      executionMode: "manual" as const,
      parallelExecution: {
        enabled: oauthScenario() === "parallel-enabled",
        maxConcurrentRuns: oauthScenario() === "parallel-enabled" ? 6 : 1,
        requiresIsolatedWorkspaces: true as const,
      },
      ...(archived ? { archivedAt: Date.now() - 60_000 } : {}),
    },
    organization: {
      name: "Fixture Studio",
      slug: "fixture-studio",
      plan: freePlan ? "free" as const : "paid" as const,
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
    activeProjectCount: oauthScenario() === "capacity-override" ? 2 : 1,
    projectAllowance: {
      resource: "active_projects" as const,
      plan: freePlan ? "free" as const : "paid" as const,
      source: oauthScenario() === "capacity-override" ? "operator_override" as const : "plan" as const,
      activeProjectCount: oauthScenario() === "capacity-override" ? 2 : 1,
      ...(memberRole || freeLimitOwner ? { limit: 1, remaining: 0 } : oauthScenario() === "capacity-override" ? { limit: 5, remaining: 3 } : {}),
      canCreate: !memberRole && !freeLimitOwner,
      actions: freePlan
        ? ["use_existing" as const, "archive_existing" as const, "upgrade" as const]
        : [],
    },
    workItemAllowance: {
      resource: "total_work_items" as const,
      plan: freePlan ? "free" as const : "paid" as const,
      source: "plan" as const,
      totalWorkItemCount: 42,
      totalIsExact: true,
      ...(freePlan ? { limit: 250, remaining: 208 } : {}),
      canCreate: true,
      trackedFrom: Date.now() - 86_400_000,
      actions: [],
    },
    storage: {
      activeBytes: 1_572_864,
      reservedBytes: 524_288,
      limitBytes: 10_737_418_240,
      maximumAttachmentBytes: 262_144_000,
    },
  };
}

const settingsDependencies = {
  changelog: { load: async () => ({ rows: [], truncated: false }) },
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
      activeProjectLimit: administration.projectAllowance.limit ?? null,
      projectCapacitySource: administration.projectAllowance.source,
      canCreateProject: administration.projectAllowance.canCreate,
      repositoryUrl: administration.project.repositoryUrl,
      identifierPrefix: administration.project.identifierPrefix,
      executionMode: administration.project.executionMode,
      parallelExecution: administration.project.parallelExecution,
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
        label: ["D", "ongo CLI"].join(""),
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
      subscribeRunners(onUpdate: (value: import("../../src/lib/project-data").RunnerSnapshot) => void) {
        const now = Date.now();
        onUpdate({
          registrations: [{
            id: "runner-settings-fixture",
            projectId: project.id,
            installationId: "installation-cli",
            label: "Fixture Mac",
            platform: "darwin",
            version: "0.1.0",
            harnesses: ["codex", "claude"],
            approvalMode: "automatic",
            status: "active",
            lastSeenAt: now,
            waitingUntil: now + 20_000,
            createdAt: now - 60_000,
            updatedAt: now,
          }],
          jobs: [],
          automaticIntake: { enabled: false, revision: 0 },
          serverTime: now,
        });
        return () => undefined;
      },
      async configureAutomaticIntake(input: {
        expectedRevision: number;
        registrationId?: string;
        harness?: import("../../src/lib/project-data").RunnerHarness;
      }) {
        document.documentElement.dataset.fixtureAutomaticIntake = JSON.stringify(input);
        return {
          enabled: Boolean(input.registrationId && input.harness),
          revision: input.expectedRevision + 1,
          registrationId: input.registrationId,
          harness: input.harness,
          configuredAt: Date.now(),
        };
      },
      async updateProject(input: {
        name: string;
        repositoryUrl?: string;
        executionMode: "manual" | "autonomous";
        parallelExecution: {
          enabled: boolean;
          maxConcurrentRuns: number;
          requiresIsolatedWorkspaces: true;
        };
      }) {
        if (input.name === "Fail safely") throw new Error("fixture update detail must stay hidden");
        Object.assign(administration.project, input);
        Object.assign(project, input);
        document.documentElement.dataset.fixtureProjectUpdate = JSON.stringify(input);
      },
      async updateOrganization(name: string) {
        if (name === "Fail safely") throw new Error("fixture organization detail must stay hidden");
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        administration.organization.name = name;
        administration.organization.slug = slug;
        project.organizationName = name;
        project.organizationSlug = slug;
        document.documentElement.dataset.fixtureOrganizationUpdate = JSON.stringify({ name, slug });
        return { name, slug };
      },
      async revokeInstallation(installationId: string) {
        if (oauthScenario() === "mutation-error") throw new Error("fixture revoke detail must stay hidden");
        document.documentElement.dataset.fixtureRevokedInstallation = installationId;
      },
      async revokeRunner(registrationId: string) {
        document.documentElement.dataset.fixtureRevokedRunner = registrationId;
        const now = Date.now();
        return {
          id: registrationId,
          projectId: project.id,
          installationId: "installation-cli",
          label: "Fixture Mac",
          platform: "darwin" as const,
          version: "0.1.0",
          harnesses: ["codex" as const, "claude" as const],
          approvalMode: "ask" as const,
          status: "revoked" as const,
          createdAt: now - 60_000,
          updatedAt: now,
          revokedAt: now,
        };
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
    identifier: "dong006",
    legacyIdentifiers: ["DONGO-6"],
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
    identifier: "dong005",
    legacyIdentifiers: ["DONGO-5"],
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
    identifier: "dong004",
    legacyIdentifiers: ["DONGO-4"],
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
        if (oauthScenario() === "overview-free-limit") {
          return {
            ...connected,
            availableProjects: connected.availableProjects.map((project) => ({
              ...project,
              organizationPlan: "free" as const,
              activeProjectCount: 2,
              activeProjectLimit: 2,
              projectCapacitySource: "plan" as const,
              canCreateProject: false,
            })),
          };
        }
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
      loadPlatformAccess={async () => oauthScenario() === "overview-super-admin"}
    />
  );
}

const platformDashboard: PlatformDashboard = {
  generatedAt: Date.now(),
  accounts: [{
    profileId: "profile-owner",
    name: "Fixture Owner",
    email: "owner@example.test",
    signedUpAt: Date.now() - 86_400_000,
    lastActiveAt: Date.now() - 60_000,
    organizationCount: 1,
    organizationsTruncated: false,
    usage: {
      workItemsCreated: 42,
      workItemsClosed: 30,
      trackedFrom: Date.now() - 86_400_000,
    },
  }],
  organizations: [{
    organizationId: "organization-fixture",
    name: "Fixture Studio",
    slug: "fixture-studio",
    plan: "free",
    createdAt: Date.now() - 86_400_000,
    updatedAt: Date.now() - 60_000,
    projectCapacityRevision: 2,
    workCapacityRevision: 3,
    members: {
      count: 2,
      truncated: false,
      people: [
        { profileId: "profile-owner", name: "Fixture Owner", email: "owner@fixture.test", role: "owner" as const, joinedAt: Date.now() - 86_400_000 },
        { profileId: "profile-member", name: "Fixture Member", email: "member@fixture.test", role: "member" as const, joinedAt: Date.now() - 43_200_000 },
      ],
    },
    projects: { active: 2, activeTruncated: false, total: 2, truncated: false, limit: 4, source: "operator_override" },
    workItems: {
      total: 42,
      totalIsExact: true,
      closed: 30,
      truncated: false,
      limit: 250,
      source: "plan",
      trackedFrom: Date.now() - 86_400_000,
    },
    billing: { status: "not_configured", provider: null },
  }],
  accountsTruncated: false,
  organizationsTruncated: false,
  privacy: "Aggregated product activity only. Work titles, comments, attachments, and raw billing data are not included.",
};

function FixturePlatformAdmin() {
  return (
    <PlatformAdmin
      connect={async (): Promise<PlatformAdminConnection> => {
        if (oauthScenario() === "admin-error") throw new Error("private fixture detail");
        let current = structuredClone(platformDashboard);
        if (oauthScenario() === "admin-pagination") {
          current.accountCursor = "accounts-next";
          current.organizationCursor = "organizations-next";
          current.accountsTruncated = true;
          current.organizationsTruncated = true;
        }
        return {
          async loadDashboard() {
            return structuredClone(current);
          },
          async loadAccounts() {
            return {
              rows: [{
                profileId: "profile-older",
                name: "Older Account",
                email: "older@example.test",
                signedUpAt: Date.now() - 172_800_000,
                lastActiveAt: Date.now() - 86_400_000,
                organizationCount: 1,
                organizationsTruncated: false,
                usage: { workItemsCreated: 7, workItemsClosed: 5 },
              }],
            };
          },
          async loadOrganizations() {
            return {
              rows: [{
                ...current.organizations[0]!,
                organizationId: "organization-older",
                name: "Older Studio",
                slug: "older-studio",
              }],
            };
          },
          async updateOrganizationAllowances(input) {
            const organization = current.organizations[0]!;
            const updated = {
              ...organization,
              changed: true,
              projectCapacityRevision: organization.projectCapacityRevision + 1,
              workCapacityRevision: organization.workCapacityRevision + 1,
              projects: {
                ...organization.projects,
                limit: input.activeProjectLimit ?? 1,
                source: input.activeProjectLimit === null ? "plan" as const : "operator_override" as const,
              },
              workItems: {
                ...organization.workItems,
                limit: input.totalWorkItemLimit ?? 250,
                source: input.totalWorkItemLimit === null ? "plan" as const : "operator_override" as const,
              },
            };
            current = { ...current, organizations: [updated] };
            document.documentElement.dataset.fixtureAdminUpdate = JSON.stringify(input);
            return updated;
          },
          async close() {
            document.documentElement.dataset.fixtureAdminClosed = "true";
          },
        };
      }}
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

function FixtureOpen() {
  return (
    <OpenRoute
      dependencies={{
        async humanSession() {
          document.documentElement.dataset.fixtureOpenSessionChecked = "true";
          return oauthScenario() === "missing-session" ? null : fixtureSession();
        },
        async bootstrapHumanIdentity() {
          document.documentElement.dataset.fixtureOpenIdentityBootstrapped = "true";
        },
        async listAuthorizableProjects() {
          return oauthScenario() === "no-project" ? [] : oauthProjects;
        },
      }}
    />
  );
}

function FixtureChangelogPublisher() {
  const [rows, setRows] = createSignal<PublishableWorkRow[]>([
    { workItemId: "work-1", revision: 0, identifier: "FIX-1", title: "Completed and unpublished", completedAt: Date.UTC(2026, 2, 19) },
    {
      workItemId: "work-2",
      revision: 1,
      identifier: "FIX-2",
      title: "Completed and already published",
      completedAt: Date.UTC(2026, 1, 27),
      published: {
        entryId: "entry-2",
        title: "Published headline",
        summary: "Published summary.",
        publishedAt: Date.UTC(2026, 1, 27),
      },
    },
  ]);
  return (
    <ChangelogPublisher
      projectId="project-fixture"
      load={async (_projectId, cursor) => {
        if (oauthScenario() === "changelog-error") throw new Error("fixture load failure");
        if (oauthScenario() === "changelog-truncated") {
          return cursor ? { rows: rows().slice(1), truncated: false } : { rows: rows().slice(0, 1), truncated: true, cursor: "older" };
        }
        return { rows: rows(), truncated: false };
      }}
      publish={async (input) => {
        if (oauthScenario() === "changelog-conflict") throw new Error("fixture revision conflict");
        setRows((current) => current.map((row) => row.workItemId === input.workItemId
          ? { ...row, revision: row.revision + 1, published: { entryId: `entry-${row.workItemId}`, title: input.title, summary: input.summary, publishedAt: Date.now() } }
          : row));
      }}
      unpublish={async (input) => {
        setRows((current) => current.map((row) => row.published?.entryId === input.entryId
          ? { ...row, revision: row.revision + 1, published: undefined }
          : row));
      }}
    />
  );
}

function FixtureChangelog() {
  const scenario = new URLSearchParams(window.location.search).get("scenario");
  return (
    <PublicChangelog
      load={async () => {
        if (scenario === "changelog-error") throw new Error("fixture load failure");
        return scenario === "changelog-empty" ? [] : [
        {
          entryId: "entry-newer",
          title: "Owners can name their organization",
          summary: "Pick the name during setup and rename it later without breaking links.",
          publishedAt: Date.UTC(2026, 2, 19),
        },
        {
          entryId: "entry-older",
          title: "Administration shows who owns what",
          summary: "Every organization now lists its people beside its allowances.",
          publishedAt: Date.UTC(2026, 1, 27),
        },
      ]; }}
    />
  );
}

function FixtureIndex() {
  return (
    <IndexRoute
      dependencies={{
        async humanSession() {
          document.documentElement.dataset.fixtureIndexSessionChecked = "true";
          return oauthScenario() === "signed-in" ? fixtureSession() : null;
        },
        async bootstrapHumanIdentity() {
          document.documentElement.dataset.fixtureIndexIdentityBootstrapped = "true";
        },
        async listAuthorizableProjects() {
          return oauthProjects;
        },
      }}
    />
  );
}

const root = document.getElementById("app");
if (!root) throw new Error("E2E fixture root is unavailable");

render(
  () => (
    <MetaProvider>
      <Router>
        <Route path="/" component={FixtureIndex} />
        <Route path="/open" component={FixtureOpen} />
        <Route path="/get-started" component={GetStartedGuide} />
        <Route path="/help" component={PublicHelpGuide} />
        <Route path="/security" component={SecurityOverview} />
        <Route path="/changelog" component={FixtureChangelog} />
        <Route path="/changelog-publisher" component={FixtureChangelogPublisher} />
        <Route path="/login" component={FixtureLogin} />
        <Route path="/auth/code" component={FixtureEmailCode} />
        <Route path="/auth/callback" component={FixtureAuthCallback} />
        <Route path="/onboarding" component={() => <OnboardingRoute dependencies={onboardingDependencies} />} />
        <Route path="/device" component={() => <DeviceAuthorizationRoute dependencies={deviceDependencies} />} />
        <Route path="/oauth/project" component={() => <OAuthProjectRoute dependencies={oauthProjectDependencies} />} />
        <Route path="/oauth/consent" component={() => <OAuthConsentRoute dependencies={oauthConsentDependencies} />} />
        <Route path="/connect" component={() => <ConnectRoute dependencies={connectDependencies} />} />
        <Route path="/admin" component={FixturePlatformAdmin} />
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
          path="/app/:orgSlug/:projectSlug/upgrade"
          component={() => (
            <UpgradePlan
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
        <Route
          path="/app/:orgSlug/:projectSlug/help"
          component={() => <HelpGuide orgSlug="fixture-studio" projectSlug="dongo" />}
        />
        <Route
          path="/app/:orgSlug/:projectSlug/ideas"
          component={() => <Ideas orgSlug="fixture-studio" projectSlug="dongo" connect={connectFixtureIdeas} />}
        />
        <Route path="*" component={FixtureOverview} />
      </Router>
    </MetaProvider>
  ),
  root,
);
