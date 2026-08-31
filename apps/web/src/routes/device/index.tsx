import { A, useLocation, useNavigate, useSearchParams } from "@solidjs/router";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";

import { AuthFrame } from "../../components/AuthFrame";
import { humanSession } from "../../lib/auth-client";
import {
  AuthorizationFlowError,
  bridgeAuthorizationSession,
  createFirstProject,
  decideDeviceRequest,
  getDeviceRequest,
  listAuthorizableProjects,
  selectAuthorizationProject,
  type AuthorizableProject,
  type DeviceRequest,
} from "../../lib/authorization-client";
import { formatUserCode, loginHref, normalizeUserCode } from "../../lib/auth-flow";
import { slugify } from "../../lib/slug";

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
  createFirstProject: typeof createFirstProject;
  selectAuthorizationProject: typeof selectAuthorizationProject;
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
  }>();
  const initialCode = normalizeUserCode(searchParams.user_code ?? "");
  const [userCode, setUserCode] = createSignal(initialCode);
  const [state, setState] = createSignal<ApprovalState>(initialCode ? "loading" : "entry");
  const [request, setRequest] = createSignal<DeviceRequest>();
  const [projects, setProjects] = createSignal<AuthorizableProject[]>([]);
  const [accountUser, setAccountUser] = createSignal<HumanUser>();
  const [account, setAccount] = createSignal("");
  const [error, setError] = createSignal("");
  const loadHumanSession = props.dependencies?.humanSession ?? humanSession;
  const bridgeSession = props.dependencies?.bridgeAuthorizationSession ?? bridgeAuthorizationSession;
  const loadDeviceRequest = props.dependencies?.getDeviceRequest ?? getDeviceRequest;
  const loadProjects = props.dependencies?.listAuthorizableProjects ?? listAuthorizableProjects;
  const provisionFirstProject = props.dependencies?.createFirstProject ?? createFirstProject;
  const chooseProject = props.dependencies?.selectAuthorizationProject ?? selectAuthorizationProject;
  const saveDecision = props.dependencies?.decideDeviceRequest ?? decideDeviceRequest;
  const currentReturnTo = () => `${location.pathname}${location.search}`;
  const onboardingHref = () => `/onboarding?returnTo=${encodeURIComponent(currentReturnTo())}`;
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
  const projectResolution = createMemo(() => resolveAgentSelectedProject({
    projects: projects(),
    projectRef: searchParams.project_ref,
    projectName: projectProposal()?.name,
    repositoryUrl: projectProposal()?.repositoryUrl,
  }));
  const selectedProject = createMemo(() => projectResolution().project);
  const canApprove = createMemo(() => Boolean(selectedProject() || (projects().length === 0 && projectProposal())));

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
      setAccount(session.user.email || session.user.name || "dongo account");
      await bridgeSession(currentReturnTo());
      const [deviceRequest, availableProjects] = await Promise.all([
        loadDeviceRequest(code),
        loadProjects(),
      ]);
      if (deviceRequest.status !== "pending") {
        throw new AuthorizationFlowError("conflict", "This authorization request has already been completed.");
      }
      setRequest(deviceRequest);
      setProjects(availableProjects);
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
        if (!approvedProject) {
          const proposal = projectProposal();
          const user = accountUser();
          if (!proposal || !user) throw new AuthorizationFlowError("invalid", "The CLI project proposal is incomplete.");
          const created = await provisionFirstProject({
            user,
            name: proposal.name,
            slug: proposal.slug,
            repositoryUrl: proposal.repositoryUrl,
            executionMode: proposal.executionMode,
          });
          approvedProject = {
            publicRef: created.publicRef,
            name: proposal.name,
            slug: proposal.slug,
            organizationName: user.name?.trim() || user.email || "Personal workspace",
            organizationSlug: created.organizationSlug,
            repositoryUrl: proposal.repositoryUrl,
          };
          setProjects([approvedProject]);
        }
        await chooseProject(approvedProject.publicRef, currentReturnTo());
      }
      await saveDecision(userCode(), accept);
      setState(accept ? "approved" : "denied");
    } catch (cause) {
      setError(cause instanceof AuthorizationFlowError ? cause.message : "The authorization decision could not be saved.");
      setState("error");
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
            <h1 class="auth-title">Authorize dongo CLI</h1>
            <p class="auth-lede">Confirm this is the terminal and project you intended to authorize.</p>
          </div>
          <div class="field-group">
            <div class="field-label">Comparison code</div>
            <div class="authorization-card__code" aria-describedby="device-warning">{formatUserCode(loaded().userCode)}</div>
          </div>
          <div class="consent-summary">
            <div class="consent-summary__row"><span class="consent-summary__key">client</span><span class="consent-summary__value">{loaded().clientId === "dongo-cli" ? "dongo CLI · official client" : loaded().clientId}</span></div>
            <div class="consent-summary__row"><span class="consent-summary__key">account</span><span class="consent-summary__value">{account()}</span></div>
            <div class="consent-summary__row">
              <Show
                when={projects().length > 0}
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
            <div class="consent-summary__row"><span class="consent-summary__key">resource</span><span class="consent-summary__value mono">{loaded().resources.join(", ") || "dongo agent API"}</span></div>
            <div class="consent-summary__row"><span class="consent-summary__key">status</span><span class="consent-summary__value">{loaded().status}</span></div>
          </div>
          <div class="field-group">
            <div class="field-label">Requested access</div>
            <ul class="scope-list">
              <Show when={projects().length === 0 && projectProposal()}>{(proposal) => (
                <li>Create “{proposal().name}” as this account’s first project and bind this terminal to it.</li>
              )}</Show>
              <For each={loaded().scopes}>{(scope) => <li>{scopeCopy[scope] || scope}</li>}</For>
            </ul>
          </div>
          <Show when={projects().length === 0}>
            <div class="auth-stack" role="status">
              <Show
                when={projectProposal()}
                fallback={<>
                  <p class="auth-lede">Create your first project to continue this terminal authorization.</p>
                  <A class="button button--primary button--full" href={onboardingHref()}>Create project</A>
                </>}
              >{(proposal) => <>
                <div class="field-label">CLI project proposal</div>
                <p class="auth-lede">
                  {proposal().name}
                  {proposal().repositoryUrl ? <> · <span class="mono">{proposal().repositoryUrl}</span></> : null}
                  {` · ${proposal().executionMode} mode`}
                </p>
                <p class="note">To change these details, deny this request and rerun <span class="mono">dongo connect</span> with project options.</p>
              </>}</Show>
            </div>
          </Show>
          <Show when={projects().length > 0 && !selectedProject()}>
            <div class="error" role="alert">
              dongo could not match this repository to exactly one active project. Deny this request and let the agent reconnect with an exact project reference.
            </div>
          </Show>
          <Show when={selectedProject()}>
            <p class="note">Project selected by the dongo CLI from this repository. Confirm the binding above; project selection is not editable during approval.</p>
          </Show>
          <Show when={error()}><div class="error" role="alert">{error()}</div></Show>
          <p class="note" id="device-warning">Approve only if this code matches a terminal in your possession. Do not approve a code sent in a message.</p>
          <div class="consent-actions">
            <button class="button" type="button" onClick={() => void decide(false)}>Deny</button>
            <button class="button button--primary" type="button" disabled={!canApprove()} onClick={() => void decide(true)}>{projects().length === 0 && projectProposal() ? "Create & approve" : "Approve"}</button>
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
            <p class="auth-lede">{state() === "approved" ? "dongo is approved. Return to your terminal while it finishes secure storage and its connection check; only the terminal will report Connected." : "No token was issued. You can close this page or restart dongo connect."}</p>
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
