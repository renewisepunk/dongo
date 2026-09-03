import { A, useLocation, useNavigate, useSearchParams } from "@solidjs/router";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";

import { AuthFrame } from "../../components/AuthFrame";
import { humanSession } from "../../lib/auth-client";
import {
  AuthorizationFlowError,
  bridgeAuthorizationSession,
  createFirstProject,
  decideDeviceRequest,
  getProjectCreationContext,
  getDeviceRequest,
  listAuthorizableProjects,
  preauthorizeMcpHost,
  selectAuthorizationProject,
  type AuthorizableProject,
  type DeviceRequest,
  type ProjectCreationContext,
} from "../../lib/authorization-client";
import { formatUserCode, loginHref, normalizeUserCode } from "../../lib/auth-flow";
import {
  DEFAULT_PARALLEL_RUN_LIMIT,
  parallelExecutionPolicy,
} from "../../lib/parallel-execution";
import { organizationSlugify, slugify } from "../../lib/slug";
import { upgradePath } from "../../lib/plans";

type ApprovalState = "entry" | "loading" | "review" | "approved" | "denied" | "error";

type HumanUser = { id: string; email?: string; name?: string };

type FirstProjectProposal = {
  name: string;
  slug: string;
  repositoryUrl?: string;
  executionMode: "manual" | "autonomous";
};

type ProjectResolution = {
  project?: AuthorizableProject;
  strategy?: "reference" | "repository" | "name" | "only-project";
};

function repositoryKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return undefined;
    const pathname = parsed.pathname.replace(/\.git$/iu, "").replace(/\/+$/u, "");
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}`.toLowerCase();
  } catch {
    return undefined;
  }
}

function oneProject(projects: AuthorizableProject[]): AuthorizableProject | undefined {
  return projects.length === 1 ? projects[0] : undefined;
}

export function resolveAgentSelectedProject(input: {
  projects: AuthorizableProject[];
  projectRef?: string;
  projectName?: string;
  repositoryUrl?: string;
}): ProjectResolution {
  const requestedRef = input.projectRef?.trim();
  if (requestedRef) {
    const project = input.projects.find((candidate) => candidate.publicRef === requestedRef);
    if (project) return { project, strategy: "reference" };
  }
  const requestedRepository = repositoryKey(input.repositoryUrl);
  if (requestedRepository) {
    const matches = input.projects.filter((project) => repositoryKey(project.repositoryUrl) === requestedRepository);
    const project = oneProject(matches);
    if (project) return { project, strategy: "repository" };
  }
  const requestedName = input.projectName?.trim().toLowerCase();
  if (requestedName) {
    const matches = input.projects.filter((project) =>
      project.name.trim().toLowerCase() === requestedName || project.slug.trim().toLowerCase() === requestedName
    );
    const project = oneProject(matches);
    if (project) return { project, strategy: "name" };
  }
  const project = oneProject(input.projects);
  return project ? { project, strategy: "only-project" } : {};
}

const scopeCopy: Record<string, string> = {
  "dongo:work:read": "Read this project’s Intake, work, comments, and artifacts.",
  "dongo:work:write": "Create, claim, and update work for this project.",
  "dongo:attachments:read": "Download attachments from this project when requested.",
  offline_access: "Stay signed in securely until you revoke this installation.",
};

export type DeviceAuthorizationRouteDependencies = {
  humanSession: () => Promise<{
    user: HumanUser;
  } | null>;
  bridgeAuthorizationSession: typeof bridgeAuthorizationSession;
  getDeviceRequest: typeof getDeviceRequest;
  listAuthorizableProjects: typeof listAuthorizableProjects;
  getProjectCreationContext: typeof getProjectCreationContext;
  createFirstProject: typeof createFirstProject;
  selectAuthorizationProject: typeof selectAuthorizationProject;
  preauthorizeMcpHost: typeof preauthorizeMcpHost;
  decideDeviceRequest: typeof decideDeviceRequest;
};

export type DeviceAuthorizationRouteProps = {
  dependencies?: Partial<DeviceAuthorizationRouteDependencies>;
};

export default function DeviceAuthorizationRoute(props: DeviceAuthorizationRouteProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams<{
    user_code?: string;
    project_ref?: string;
    project_name?: string;
    repository_url?: string;
    execution_mode?: string;
    project_action?: string;
    agent_host?: string;
  }>();
  const initialCode = normalizeUserCode(searchParams.user_code ?? "");
  const [userCode, setUserCode] = createSignal(initialCode);
  const [state, setState] = createSignal<ApprovalState>(initialCode ? "loading" : "entry");
  const [request, setRequest] = createSignal<DeviceRequest>();
  const [projects, setProjects] = createSignal<AuthorizableProject[]>([]);
  const [creationContext, setCreationContext] = createSignal<ProjectCreationContext>();
  const [selectedOrganizationId, setSelectedOrganizationId] = createSignal("");
  const [organizationName, setOrganizationName] = createSignal("");
  const [accountUser, setAccountUser] = createSignal<HumanUser>();
  const [error, setError] = createSignal("");
  const [serverPlanBlocked, setServerPlanBlocked] = createSignal(false);
  const [allowParallelWork, setAllowParallelWork] = createSignal(false);
  const [maxConcurrentRuns, setMaxConcurrentRuns] = createSignal(DEFAULT_PARALLEL_RUN_LIMIT);
  const loadHumanSession = props.dependencies?.humanSession ?? humanSession;
  const bridgeSession = props.dependencies?.bridgeAuthorizationSession ?? bridgeAuthorizationSession;
  const loadDeviceRequest = props.dependencies?.getDeviceRequest ?? getDeviceRequest;
  const loadProjects = props.dependencies?.listAuthorizableProjects ?? listAuthorizableProjects;
  const loadProjectCreationContext = props.dependencies?.getProjectCreationContext ?? getProjectCreationContext;
  const provisionFirstProject = props.dependencies?.createFirstProject ?? createFirstProject;
  const chooseProject = props.dependencies?.selectAuthorizationProject ?? selectAuthorizationProject;
  const authorizeHost = props.dependencies?.preauthorizeMcpHost ?? preauthorizeMcpHost;
  const saveDecision = props.dependencies?.decideDeviceRequest ?? decideDeviceRequest;
  const currentReturnTo = () => `${location.pathname}${location.search}`;
  const createIntent = createMemo(() => searchParams.project_action === "create");
  const agentHost = createMemo(() => searchParams.agent_host === "codex" ? "codex" as const : undefined);
  const selectedOrganization = createMemo(() => {
    const organizations = creationContext()?.organizations ?? [];
    return organizations.find((organization) => organization.id === selectedOrganizationId()) ?? organizations[0];
  });
  const creationTargetProject = createMemo(() => {
    const organization = selectedOrganization();
    return creationContext()?.projects.find(
      (project) => project.organizationSlug === organization?.slug,
    ) ?? creationContext()?.projects[0];
  });
  const onboardingHref = () => {
    const params = new URLSearchParams({ returnTo: currentReturnTo() });
    const organization = selectedOrganization();
    if (organization) params.set("organization", organization.slug);
    return `/onboarding?${params.toString()}`;
  };
  const projectProposal = createMemo<FirstProjectProposal | undefined>(() => {
    const name = searchParams.project_name?.trim();
    if (!name || name.length > 120) return undefined;
    const slug = slugify(name);
    if (!slug) return undefined;
    if (
      searchParams.execution_mode !== undefined
      && searchParams.execution_mode !== "manual"
      && searchParams.execution_mode !== "autonomous"
    ) return undefined;
    const executionMode = searchParams.execution_mode ?? "manual";
    const rawRepositoryUrl = searchParams.repository_url?.trim();
    let repositoryUrl: string | undefined;
    if (rawRepositoryUrl) {
      if (rawRepositoryUrl.length > 2_048) return undefined;
      try {
        const parsed = new URL(rawRepositoryUrl);
        if (
          !["http:", "https:"].includes(parsed.protocol)
          || parsed.username
          || parsed.password
          || parsed.search
          || parsed.hash
        ) return undefined;
        repositoryUrl = parsed.toString();
      } catch {
        return undefined;
      }
    }
    return { name, slug, repositoryUrl, executionMode };
  });
  const projectResolution = createMemo(() => createIntent()
    ? {}
    : resolveAgentSelectedProject({
        projects: projects(),
        projectRef: searchParams.project_ref,
        projectName: projectProposal()?.name,
        repositoryUrl: projectProposal()?.repositoryUrl,
      }));
  const selectedProject = createMemo(() => projectResolution().project);
  const wantsProjectCreation = createMemo(() =>
    createIntent() || projects().length === 0,
  );
  const createsOrganization = createMemo(() => {
    const context = creationContext();
    return Boolean(context && context.organizations.length === 0 && context.projects.length === 0);
  });
  const canCreateProject = createMemo(() => {
    if (serverPlanBlocked()) return false;
    if (!projectProposal()) return false;
    const context = creationContext();
    if (!context) return false;
    if (context.organizations.length === 0) {
      return context.projects.length === 0 && Boolean(organizationSlugify(organizationName()));
    }
    return selectedOrganization()?.canCreate === true;
  });
  const projectLimitReached = createMemo(() =>
    wantsProjectCreation() && (serverPlanBlocked() || selectedOrganization()?.canCreate === false),
  );
  const canApprove = createMemo(() => Boolean(
    wantsProjectCreation() ? canCreateProject() : selectedProject(),
  ));
  const creationTargetHref = (suffix = "") => {
    const project = creationTargetProject();
    return project
      ? `/app/${encodeURIComponent(project.organizationSlug)}/${encodeURIComponent(project.slug)}${suffix}`
      : "/open";
  };
  const upgradeTargetHref = () => {
    const project = creationTargetProject();
    return project
      ? upgradePath(project.organizationSlug, project.slug)
      : "/open";
  };

  const load = async () => {
    const code = normalizeUserCode(userCode());
    if (code.length !== 8) {
      setError("Enter the eight-character comparison code from your terminal.");
      setState("entry");
      return;
    }
    setUserCode(code);
    setState("loading");
    setError("");
    try {
      const session = await loadHumanSession();
      if (!session) {
        navigate(loginHref(currentReturnTo()), { replace: true });
        return;
      }
      setAccountUser(session.user);
      setOrganizationName(
        session.user.name?.trim() || session.user.email?.split("@")[0] || "Personal workspace",
      );
      await bridgeSession(currentReturnTo());
      const [deviceRequest, availableProjects, projectCreationContext] = await Promise.all([
        loadDeviceRequest(code),
        loadProjects(),
        loadProjectCreationContext(),
      ]);
      if (deviceRequest.status !== "pending") {
        throw new AuthorizationFlowError("conflict", "This authorization request has already been completed.");
      }
      setRequest(deviceRequest);
      setProjects(availableProjects);
      setCreationContext(projectCreationContext);
      setSelectedOrganizationId(projectCreationContext.organizations[0]?.id ?? "");
      setState("review");
    } catch (cause) {
      if (cause instanceof AuthorizationFlowError && cause.code === "authentication_required") {
        navigate(loginHref(currentReturnTo()), { replace: true });
        return;
      }
      setError(cause instanceof AuthorizationFlowError ? cause.message : "This authorization request could not be loaded.");
      setState("error");
    }
  };

  onMount(() => {
    if (initialCode) void load();
  });

  const decide = async (accept: boolean) => {
    if (accept && !canApprove()) {
      setError("dongo could not resolve exactly one project for this repository. Deny this request and let the agent reconnect with an exact project reference.");
      return;
    }
    setState("loading");
    setError("");
    try {
      if (accept) {
        let approvedProject = selectedProject();
        if (wantsProjectCreation()) {
          const proposal = projectProposal();
          const user = accountUser();
          if (!proposal || !user) throw new AuthorizationFlowError("invalid", "The CLI project proposal is incomplete.");
          const created = await provisionFirstProject({
            user,
            organizationId: selectedOrganization()?.id,
            organizationName: createsOrganization() ? organizationName().trim() : undefined,
            name: proposal.name,
            slug: proposal.slug,
            repositoryUrl: proposal.repositoryUrl,
            executionMode: proposal.executionMode,
            parallelExecution: parallelExecutionPolicy(
              allowParallelWork(),
              maxConcurrentRuns(),
            ),
          });
          approvedProject = {
            publicRef: created.publicRef,
            name: proposal.name,
            slug: proposal.slug,
            organizationName: createsOrganization()
              ? organizationName().trim()
              : selectedOrganization()?.name || user.name?.trim() || user.email || "Personal workspace",
            organizationSlug: created.organizationSlug,
            repositoryUrl: proposal.repositoryUrl,
          };
          setProjects([...projects(), approvedProject]);
        }
        if (!approvedProject) throw new AuthorizationFlowError("invalid", "The project binding is incomplete.");
        await chooseProject(approvedProject.publicRef, currentReturnTo());
        if (agentHost()) {
          await authorizeHost({
            projectRef: approvedProject.publicRef,
            userCode: userCode(),
            host: agentHost()!,
            returnTo: currentReturnTo(),
          });
        }
      }
      await saveDecision(userCode(), accept);
      setState(accept ? "approved" : "denied");
    } catch (cause) {
      const message = cause instanceof AuthorizationFlowError ? cause.message : "The authorization decision could not be saved.";
      if (cause instanceof AuthorizationFlowError && /free plan/i.test(message)) {
        setServerPlanBlocked(true);
        setError(message);
        setState("review");
      } else {
        setError(message);
        setState("error");
      }
    }
  };

  return (
    <AuthFrame>
      <Show when={state() === "entry"}>
        <form class="auth-stack" onSubmit={(event) => { event.preventDefault(); void load(); }}>
          <div class="title-group">
            <div class="eyebrow eyebrow--amber">Authorize terminal</div>
            <h1 class="auth-title">Review a dongo CLI request</h1>
            <p class="auth-lede">The normal terminal link fills this code automatically.</p>
          </div>
          <div class="field-group">
            <label class="field-label" for="device-code-entry">Comparison code</label>
            <input class="input input--code" id="device-code-entry" value={formatUserCode(userCode())} onInput={(event) => { setUserCode(normalizeUserCode(event.currentTarget.value)); setError(""); }} maxlength={9} autocomplete="off" />
            <Show when={error()}><div class="error" role="alert">{error()}</div></Show>
          </div>
          <button class="button button--primary button--full" type="submit" disabled={userCode().length !== 8}>Review request</button>
        </form>
      </Show>

      <Show when={state() === "loading"}>
        <div class="callback" role="status" aria-live="polite"><span class="spinner" aria-hidden="true" /><span>Checking the authorization request…</span></div>
      </Show>

      <Show when={state() === "review" && request()}>{(loaded) => (
        <div class="auth-stack">
          <div class="title-group">
            <div class="eyebrow eyebrow--amber">Authorize terminal</div>
            <h1 class="auth-title">Authorize dongo CLI{agentHost() === "codex" ? " + Codex" : ""}</h1>
            <p class="auth-lede">Confirm this is the terminal, agent host, and project you intended to authorize.</p>
          </div>
          <div class="field-group">
            <div class="field-label">Comparison code</div>
            <div class="authorization-card__code" aria-describedby="device-warning">{formatUserCode(loaded().userCode)}</div>
          </div>
          <div class="consent-summary">
            <div class="consent-summary__row"><span class="consent-summary__key">client</span><span class="consent-summary__value">{loaded().clientId === "dongo-cli" ? "dongo CLI · official client" : loaded().clientId}</span></div>
            <div class="consent-summary__row">
              <Show
                when={!wantsProjectCreation() && projects().length > 0}
                fallback={<><span class="consent-summary__key">project</span><span class="consent-summary__value">{projectProposal() ? `New: ${projectProposal()!.name}` : "No project yet"}</span></>}
              >
                <span class="consent-summary__key">project</span>
                <span class="consent-summary__value">
                  {selectedProject()
                    ? `${selectedProject()!.organizationName} / ${selectedProject()!.name}`
                    : "No unambiguous project match"}
                </span>
              </Show>
            </div>
          </div>
          <div class="field-group">
            <div class="field-label">Requested access</div>
            <ul class="scope-list">
              <Show when={wantsProjectCreation() && projectProposal()}>{(proposal) => (
                <li>Create “{proposal().name}” as {projects().length === 0 ? "this account’s first project" : "another project"} and bind this terminal to it.</li>
              )}</Show>
              <Show when={agentHost() === "codex"}>
                <li>Authorize Codex for the same project so its separate secure login completes without another dongo approval.</li>
              </Show>
              <For each={loaded().scopes}>{(scope) => <li>{scopeCopy[scope] || scope}</li>}</For>
            </ul>
          </div>
          <Show when={wantsProjectCreation()}>
            <div class="auth-stack" role="status">
              <Show
                when={projectProposal()}
                fallback={<>
                  <p class="auth-lede">A complete project proposal is required to continue this terminal authorization.</p>
                  <A class="button button--primary button--full" href={onboardingHref()}>Create project</A>
                </>}
              >{(proposal) => <>
                <div class="field-label">CLI project proposal</div>
                <p class="auth-lede">
                  {proposal().name}
                  {` · ${proposal().executionMode} mode`}
                </p>
                <p class="note">This creates a new project; it will not reuse an existing repository binding. To change these details, deny this request and rerun <span class="mono">dongo project create</span> with project options.</p>
                <Show when={createsOrganization()}>
                  <div class="field-group">
                    <label class="field-label" for="device-organization-name">Organization name</label>
                    <input
                      class="input"
                      id="device-organization-name"
                      required
                      value={organizationName()}
                      onInput={(event) => { setOrganizationName(event.currentTarget.value); setError(""); }}
                    />
                    <p class="note">Organization address: <span class="mono">{organizationSlugify(organizationName())}</span>. dongo adds a unique suffix only when needed.</p>
                  </div>
                </Show>
                <div class="parallel-option" data-enabled={allowParallelWork()}>
                  <div class="parallel-option__status" aria-live="polite">{allowParallelWork() ? "Parallel work enabled" : "Single-agent"}</div>
                  <label class="parallel-option__toggle" for="device-parallel-work">
                    <input
                      id="device-parallel-work"
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
                    <label class="parallel-option__limit" for="device-parallel-run-limit">
                      <span>Maximum concurrent runs <small>Safety cap</small></span>
                      <select
                        class="input mono"
                        id="device-parallel-run-limit"
                        value={maxConcurrentRuns()}
                        onChange={(event) => setMaxConcurrentRuns(Number(event.currentTarget.value))}
                      >
                        {[2, 3, 4, 5, 6, 7, 8].map((limit) => <option value={limit}>{limit}</option>)}
                      </select>
                    </label>
                  </Show>
                  <p class="security-note">dongo coordinates claims. Your agent host creates agents and isolated worktrees. Hosts that do not support or report isolation continue one item at a time.</p>
                </div>
              </>}</Show>
              <Show when={selectedOrganization()}>{(organization) => (
                <div class="field-group">
                  <label class="field-label" for="device-organization">Organization</label>
                  <Show
                    when={(creationContext()?.organizations.length ?? 0) > 1}
                    fallback={<div class="input" aria-label="Organization">{organization().name}</div>}
                  >
                    <select class="input" id="device-organization" value={organization().id} onChange={(event) => { setSelectedOrganizationId(event.currentTarget.value); setServerPlanBlocked(false); setError(""); }}>
                      {creationContext()!.organizations.map((candidate) => <option value={candidate.id}>{candidate.name}</option>)}
                    </select>
                  </Show>
                  <p class="note">{organization().plan === "free"
                    ? `Free plan · ${organization().activeProjectCount} of ${organization().activeProjectLimit} active projects used.${organization().projectCapacitySource === "operator_override" ? " Additional capacity granted." : ""}`
                    : `Paid plan · ${organization().activeProjectCount} active projects; no project limit.`}</p>
                </div>
              )}</Show>
            </div>
          </Show>
          <Show when={!wantsProjectCreation() && projects().length > 0 && !selectedProject()}>
            <div class="error" role="alert">
              dongo could not match this repository to exactly one active project. Deny this request and let the agent reconnect with an exact project reference.
            </div>
          </Show>
          <Show when={!wantsProjectCreation() && selectedProject()}>
            <p class="note">Project selected by the dongo CLI from this repository. Confirm the binding above; project selection is not editable during approval.</p>
          </Show>
          <Show when={projectLimitReached()}>
            <div class="notice" role="alert">
              <strong>Free plan project limit reached.</strong>
              <p>This organization already uses all {selectedOrganization()?.activeProjectLimit ?? 1} active projects in its current allowance. Your account is signed in; logging in again will not create more capacity.</p>
            </div>
            <div class="button-stack">
              <A class="button button--full" href={creationTargetHref()}>Use existing project</A>
              <A class="button button--full" href={creationTargetHref("/settings?tab=General")}>Archive an active project</A>
              <A class="button button--quiet button--full" href={upgradeTargetHref()}>Upgrade to add projects</A>
            </div>
          </Show>
          <Show when={error()}><div class="error" role="alert">{error()}</div></Show>
          <p class="note" id="device-warning">Approve only if this code matches a terminal in your possession. Do not approve a code sent in a message.</p>
          <div class="consent-actions">
            <button class="button button--primary button--full" type="button" disabled={!canApprove()} onClick={() => void decide(true)}>{wantsProjectCreation() && projectProposal() ? `Create & approve${agentHost() === "codex" ? " both" : ""}` : `Approve${agentHost() === "codex" ? " both" : ""}`}</button>
            <button class="button button--quiet" type="button" onClick={() => void decide(false)}>Deny</button>
          </div>
        </div>
      )}</Show>

      <Show when={state() === "approved" || state() === "denied"}>
        <div class="auth-stack">
          <div class="approved-state" data-state={state()}>
            <div class="approved-state__title">
              <span style={{ color: state() === "approved" ? "var(--green)" : "var(--danger)" }}>{state() === "approved" ? "✓" : "✕"}</span>
              <span>{state() === "approved" ? "Approved — you can close this window" : "Authorization denied"}</span>
            </div>
            <p class="auth-lede">{state() === "approved" ? `${agentHost() === "codex" ? "dongo CLI and Codex are" : "dongo is"} approved for this project. Return to your terminal while it finishes secure storage and its connection check; only the terminal will report Connected.` : "No token was issued. You can close this page or restart dongo connect."}</p>
          </div>
          <p class="security-note">This page never displays access or refresh tokens.</p>
        </div>
      </Show>

      <Show when={state() === "error"}>
        <div class="auth-stack">
          <div class="title-group"><h1 class="auth-title">This request can’t be authorized</h1><p class="auth-lede">{error()}</p></div>
          <button class="button button--primary button--full" type="button" onClick={() => void load()}>Try again</button>
          <p class="note">If it expired or was already used, start a fresh <span class="mono">dongo connect</span> from the terminal.</p>
        </div>
      </Show>
    </AuthFrame>
  );
}
