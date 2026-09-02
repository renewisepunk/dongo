import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { AuthFrame } from "../components/AuthFrame";
import { RequireHumanSession } from "../components/RequireHumanSession";
import { SignOutButton } from "../components/SignOutButton";
import { humanSession } from "../lib/auth-client";
import {
  AuthorizationFlowError,
  createFirstProject,
  getProjectCreationContext,
  type ProjectCreationContext,
} from "../lib/authorization-client";
import { safeReturnTo } from "../lib/auth-flow";
import { dongoPublicOrigin } from "../lib/auth-config";
import {
  DEFAULT_PARALLEL_RUN_LIMIT,
  parallelExecutionPolicy,
} from "../lib/parallel-execution";
import { organizationSlugify, slugify } from "../lib/slug";
import { upgradePath } from "../lib/plans";

type ExecutionMode = "manual" | "autonomous";

export type OnboardingRouteDependencies = {
  humanSession: () => Promise<{
    user: { id: string; name?: string; email?: string };
  } | null>;
  bootstrapHumanIdentity: () => Promise<unknown>;
  createFirstProject: typeof createFirstProject;
  getProjectCreationContext: typeof getProjectCreationContext;
};

export type OnboardingRouteProps = {
  dependencies?: Partial<OnboardingRouteDependencies>;
};

export default function OnboardingRoute(props: OnboardingRouteProps = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams<{ returnTo?: string; organization?: string }>();
  const [name, setName] = createSignal("");
  const [organizationName, setOrganizationName] = createSignal("");
  const [repositoryUrl, setRepositoryUrl] = createSignal("");
  const [mode, setMode] = createSignal<ExecutionMode>("manual");
  const [allowParallelWork, setAllowParallelWork] = createSignal(false);
  const [maxConcurrentRuns, setMaxConcurrentRuns] = createSignal(DEFAULT_PARALLEL_RUN_LIMIT);
  const [pending, setPending] = createSignal(false);
  const [contextLoading, setContextLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [serverPlanBlocked, setServerPlanBlocked] = createSignal(false);
  const [account, setAccount] = createSignal<{ id: string; name?: string; email?: string }>();
  const [creationContext, setCreationContext] = createSignal<ProjectCreationContext>();
  const [selectedOrganizationId, setSelectedOrganizationId] = createSignal("");
  const slug = createMemo(() => slugify(name()));
  const proposedOrganizationSlug = createMemo(() => organizationSlugify(organizationName()));
  const loadHumanSession = props.dependencies?.humanSession ?? humanSession;
  const provisionFirstProject = props.dependencies?.createFirstProject ?? createFirstProject;
  const loadProjectCreationContext = props.dependencies?.getProjectCreationContext ?? getProjectCreationContext;

  const selectedOrganization = createMemo(() => {
    const organizations = creationContext()?.organizations ?? [];
    return organizations.find((organization) => organization.id === selectedOrganizationId()) ?? organizations[0];
  });
  const projectUrlOrganizationSlug = createMemo(() =>
    selectedOrganization()?.slug ?? proposedOrganizationSlug(),
  );
  const existingProject = createMemo(() => {
    const projects = creationContext()?.projects ?? [];
    const organization = selectedOrganization();
    return projects.find((project) => project.organizationSlug === organization?.slug) ?? projects[0];
  });
  const isFirstProject = createMemo(() => (creationContext()?.projects.length ?? 0) === 0);
  const createsOrganization = createMemo(() =>
    !contextLoading() && (creationContext()?.organizations.length ?? 0) === 0,
  );
  const hasOrganizationsWithoutOwnership = createMemo(() =>
    !isFirstProject() && (creationContext()?.organizations.length ?? 0) === 0,
  );
  const planLimitReached = createMemo(() => {
    if (serverPlanBlocked()) return true;
    const organization = selectedOrganization();
    return organization?.canCreate === false;
  });
  const canCreate = createMemo(() =>
    !contextLoading() && !error() && !hasOrganizationsWithoutOwnership() && !planLimitReached(),
  );
  const existingProjectHref = createMemo(() => {
    const project = existingProject();
    return project
      ? `/app/${encodeURIComponent(project.organizationSlug)}/${encodeURIComponent(project.slug)}`
      : "/open";
  });
  const projectSettingsHref = createMemo(() => {
    const project = existingProject();
    return project
      ? `/app/${encodeURIComponent(project.organizationSlug)}/${encodeURIComponent(project.slug)}/settings`
      : "/open";
  });
  const projectUpgradeHref = createMemo(() => {
    const project = existingProject();
    return project
      ? upgradePath(project.organizationSlug, project.slug)
      : "/open";
  });

  onMount(async () => {
    try {
      const session = await loadHumanSession();
      if (!session) return;
      setAccount(session.user);
      setOrganizationName(
        session.user.name?.trim() || session.user.email?.split("@")[0] || "Personal workspace",
      );
      const context = await loadProjectCreationContext();
      setCreationContext(context);
      const preferred = context.organizations.find(
        (organization) => organization.slug === searchParams.organization,
      );
      setSelectedOrganizationId(preferred?.id ?? context.organizations[0]?.id ?? "");
    } catch (cause) {
      setError(cause instanceof AuthorizationFlowError ? cause.message : "Could not load your project allowance. Try again.");
    } finally {
      setContextLoading(false);
    }
  });

  const createProject = async (event: SubmitEvent) => {
    event.preventDefault();
    const projectName = name().trim();
    if (!projectName || !slug()) {
      setError("Enter a project name.");
      return;
    }
    const newOrganizationName = organizationName().trim();
    if (createsOrganization() && !newOrganizationName) {
      setError("Enter an organization name.");
      return;
    }
    if (createsOrganization() && !proposedOrganizationSlug()) {
      setError("Use at least one letter or number in the organization name.");
      return;
    }
    let normalizedRepositoryUrl: string | undefined;
    const repository = repositoryUrl().trim();
    if (repository) {
      try {
        const parsed = new URL(repository.includes("://") ? repository : `https://${repository}`);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
        normalizedRepositoryUrl = parsed.toString();
      } catch {
        setError("Enter a valid HTTP or HTTPS repository URL.");
        return;
      }
    }
    setPending(true);
    setError("");
    try {
      const session = await loadHumanSession();
      if (!session) throw new AuthorizationFlowError("authentication_required", "Sign in again to create this project.");
      const project = await provisionFirstProject({
        user: { id: session.user.id, name: session.user.name, email: session.user.email },
        organizationId: selectedOrganization()?.id,
        organizationName: createsOrganization() ? newOrganizationName : undefined,
        name: projectName,
        slug: slug(),
        repositoryUrl: normalizedRepositoryUrl,
        executionMode: mode(),
        parallelExecution: parallelExecutionPolicy(
          allowParallelWork(),
          maxConcurrentRuns(),
        ),
      });
      sessionStorage.setItem("dongo:project", JSON.stringify({
        name: projectName,
        slug: slug(),
        repositoryUrl: normalizedRepositoryUrl,
        mode: mode(),
        parallelExecution: parallelExecutionPolicy(
          allowParallelWork(),
          maxConcurrentRuns(),
        ),
        publicRef: project.publicRef,
        projectId: project.projectId,
        organizationId: project.organizationId,
        organizationSlug: project.organizationSlug,
      }));
      navigate(safeReturnTo(searchParams.returnTo) ?? "/connect?created=1", { replace: true });
    } catch (cause) {
      const message = cause instanceof AuthorizationFlowError ? cause.message : "The project could not be created. Try again.";
      if (/free plan/i.test(message)) setServerPlanBlocked(true);
      setError(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <RequireHumanSession dependencies={props.dependencies}><AuthFrame>
      <form class="auth-stack" onSubmit={createProject}>
        <div class="title-group">
          <div class="eyebrow eyebrow--amber">Set up your workspace</div>
          <h1 class="auth-title">{isFirstProject() ? "Create your first project" : "Create another project"}</h1>
          <p class="auth-lede">A project maps to one repository or codebase. Creating one is separate from signing in and from connecting this repository or agent.</p>
        </div>

        <Show when={account()}>{(viewer) => (
          <p class="note">Signed in as {viewer().email ?? viewer().name ?? "your dongo account"}.</p>
        )}</Show>

        <Show when={contextLoading()}>
          <div class="notice" role="status">Checking your project allowance…</div>
        </Show>

        <Show when={!contextLoading() && selectedOrganization()}>{(organization) => (
          <div class="field-group">
            <label class="field-label" for="organization">Organization</label>
            <Show
              when={(creationContext()?.organizations.length ?? 0) > 1}
              fallback={<div class="input" aria-label="Organization">{organization().name}</div>}
            >
              <select
                class="input"
                id="organization"
                value={organization().id}
                onChange={(event) => { setSelectedOrganizationId(event.currentTarget.value); setError(""); setServerPlanBlocked(false); }}
              >
                {creationContext()!.organizations.map((candidate) => (
                  <option value={candidate.id}>{candidate.name}</option>
                ))}
              </select>
            </Show>
            <p class="note">
              {organization().plan === "free"
                ? `Free plan · ${organization().activeProjectCount} of ${organization().activeProjectLimit} active projects used.${organization().projectCapacitySource === "operator_override" ? " Additional capacity granted." : ""}`
                : `Paid plan · ${organization().activeProjectCount} active projects; no project limit.`}
            </p>
          </div>
        )}</Show>

        <Show when={!contextLoading() && planLimitReached()}>
          <div class="notice" role="alert">
            <strong>Free plan project limit reached.</strong>
            <p>Your organization already uses all {selectedOrganization()?.activeProjectLimit ?? 1} active projects in its current allowance. Signing in again will not change this allowance.</p>
          </div>
          <div class="button-stack">
            <A class="button button--primary button--full" href={existingProjectHref()}>Use existing project</A>
            <A class="button button--full" href={`${projectSettingsHref()}?tab=General`}>Archive an active project</A>
            <A class="button button--quiet button--full" href={projectUpgradeHref()}>Upgrade to add projects</A>
          </div>
        </Show>

        <Show when={!contextLoading() && hasOrganizationsWithoutOwnership()}>
          <div class="notice" role="alert">
            <strong>An organization owner must create this project.</strong>
            <p>Your account is authenticated, but it does not own an organization where a project can be created.</p>
          </div>
          <A class="button button--primary button--full" href={existingProjectHref()}>Use existing project</A>
        </Show>

        <Show when={!contextLoading() && !planLimitReached() && !hasOrganizationsWithoutOwnership()}>
        <Show when={createsOrganization()}>
          <div class="field-group">
            <label class="field-label" for="organization-name">Organization name</label>
            <input
              class="input"
              id="organization-name"
              required
              value={organizationName()}
              onInput={(event) => { setOrganizationName(event.currentTarget.value); setError(""); }}
              placeholder="Acme Studio"
            />
            <p class="note">dongo creates the organization address from this name and adds a unique suffix only when needed.</p>
          </div>
        </Show>
        <div class="field-group">
          <label class="field-label" for="project-name">Project name</label>
          <input
            class="input"
            id="project-name"
            required
            value={name()}
            onInput={(event) => { setName(event.currentTarget.value); setError(""); }}
            placeholder="Checkout service"
          />
          <div class="slug-preview">{new URL(dongoPublicOrigin).host}/{projectUrlOrganizationSlug()}/{slug()}</div>
        </div>

        <div class="field-group">
          <label class="field-label" for="repository-url">
            Repository URL <span class="field-label__optional">optional</span>
          </label>
          <input
            class="input mono"
            id="repository-url"
            value={repositoryUrl()}
            onInput={(event) => { setRepositoryUrl(event.currentTarget.value); setError(""); }}
            placeholder="github.com/rene/checkout"
          />
        </div>

        <div class="choice-list" role="radiogroup" aria-labelledby="execution-mode-label">
          <div class="field-label" id="execution-mode-label">Agent execution mode</div>
          <button
            class="choice"
            data-selected={mode() === "manual"}
            type="button"
            role="radio"
            aria-checked={mode() === "manual"}
            onClick={() => setMode("manual")}
          >
            <span class="choice__dot" aria-hidden="true" />
            <span class="choice__copy">
              <span class="choice__title">Manual</span>
              <span class="choice__body">Agents triage and suggest work, then wait for you.</span>
            </span>
          </button>
          <button
            class="choice"
            data-selected={mode() === "autonomous"}
            type="button"
            role="radio"
            aria-checked={mode() === "autonomous"}
            onClick={() => setMode("autonomous")}
          >
            <span class="choice__dot" aria-hidden="true" />
            <span class="choice__copy">
              <span class="choice__title">Autonomous</span>
              <span class="choice__body">Agents may claim and begin Ready work.</span>
            </span>
          </button>
        </div>

        <div class="parallel-option" data-enabled={allowParallelWork()}>
          <div class="parallel-option__status" aria-live="polite">{allowParallelWork() ? "Parallel work enabled" : "Single-agent"}</div>
          <label class="parallel-option__toggle" for="parallel-work">
            <input
              id="parallel-work"
              type="checkbox"
              checked={allowParallelWork()}
              onChange={(event) => setAllowParallelWork(event.currentTarget.checked)}
            />
            <span>
              <strong>Allow parallel work</strong>
              <span>Agents may work on separate claimed items at the same time when their host supports isolated workspaces.</span>
            </span>
          </label>
          <Show when={allowParallelWork()}>
            <label class="parallel-option__limit" for="parallel-run-limit">
              <span>Maximum concurrent runs <small>Safety cap</small></span>
              <select
                class="input mono"
                id="parallel-run-limit"
                value={maxConcurrentRuns()}
                onChange={(event) => setMaxConcurrentRuns(Number(event.currentTarget.value))}
              >
                {[2, 3, 4, 5, 6, 7, 8].map((limit) => <option value={limit}>{limit}</option>)}
              </select>
            </label>
          </Show>
          <p class="security-note">dongo coordinates claims. Your agent host creates agents and isolated worktrees. Hosts that do not support or report isolation continue one item at a time.</p>
        </div>

        <Show when={error()}><div class="error" role="alert">{error()}</div></Show>
        <button class="button button--primary button--full" type="submit" disabled={pending() || !canCreate()}>{pending() ? "Creating project…" : "Create project"}</button>
        <p class="note">After creation, dongo selects the new project and shows the steps to connect this repository or agent.</p>
        </Show>
        <SignOutButton />
      </form>
    </AuthFrame></RequireHumanSession>
  );
}
