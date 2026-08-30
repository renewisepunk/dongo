import { useLocation, useNavigate, useSearchParams } from "@solidjs/router";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";

import { AuthFrame } from "../../components/AuthFrame";
import { humanSession } from "../../lib/auth-client";
import {
  AuthorizationFlowError,
  bridgeAuthorizationSession,
  decideDeviceRequest,
  getDeviceRequest,
  listAuthorizableProjects,
  selectAuthorizationProject,
  type AuthorizableProject,
  type DeviceRequest,
} from "../../lib/authorization-client";
import { formatUserCode, loginHref, normalizeUserCode } from "../../lib/auth-flow";

type ApprovalState = "entry" | "loading" | "review" | "approved" | "denied" | "error";

const scopeCopy: Record<string, string> = {
  "dongo:work:read": "Read this project’s Intake, work, comments, and artifacts.",
  "dongo:work:write": "Create, claim, and update work for this project.",
  "dongo:attachments:read": "Download attachments from this project when requested.",
  offline_access: "Stay signed in securely until you revoke this installation.",
};

export type DeviceAuthorizationRouteDependencies = {
  humanSession: () => Promise<{
    user: { email?: string; name: string };
  } | null>;
  bridgeAuthorizationSession: typeof bridgeAuthorizationSession;
  getDeviceRequest: typeof getDeviceRequest;
  listAuthorizableProjects: typeof listAuthorizableProjects;
  selectAuthorizationProject: typeof selectAuthorizationProject;
  decideDeviceRequest: typeof decideDeviceRequest;
};

export type DeviceAuthorizationRouteProps = {
  dependencies?: Partial<DeviceAuthorizationRouteDependencies>;
};

export default function DeviceAuthorizationRoute(props: DeviceAuthorizationRouteProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams<{ user_code?: string }>();
  const initialCode = normalizeUserCode(searchParams.user_code ?? "");
  const [userCode, setUserCode] = createSignal(initialCode);
  const [state, setState] = createSignal<ApprovalState>(initialCode ? "loading" : "entry");
  const [request, setRequest] = createSignal<DeviceRequest>();
  const [projects, setProjects] = createSignal<AuthorizableProject[]>([]);
  const [projectRef, setProjectRef] = createSignal("");
  const [account, setAccount] = createSignal("");
  const [error, setError] = createSignal("");
  const loadHumanSession = props.dependencies?.humanSession ?? humanSession;
  const bridgeSession = props.dependencies?.bridgeAuthorizationSession ?? bridgeAuthorizationSession;
  const loadDeviceRequest = props.dependencies?.getDeviceRequest ?? getDeviceRequest;
  const loadProjects = props.dependencies?.listAuthorizableProjects ?? listAuthorizableProjects;
  const chooseProject = props.dependencies?.selectAuthorizationProject ?? selectAuthorizationProject;
  const saveDecision = props.dependencies?.decideDeviceRequest ?? decideDeviceRequest;
  const currentReturnTo = () => `${location.pathname}${location.search}`;
  const selectedProject = createMemo(() => projects().find((project) => project.publicRef === projectRef()));

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
        navigate(loginHref(`/device?user_code=${encodeURIComponent(formatUserCode(code))}`), { replace: true });
        return;
      }
      setAccount(session.user.email || session.user.name);
      await bridgeSession(`/device?user_code=${encodeURIComponent(formatUserCode(code))}`);
      const [deviceRequest, availableProjects] = await Promise.all([
        loadDeviceRequest(code),
        loadProjects(),
      ]);
      if (deviceRequest.status !== "pending") {
        throw new AuthorizationFlowError("conflict", "This authorization request has already been completed.");
      }
      setRequest(deviceRequest);
      setProjects(availableProjects);
      setProjectRef(availableProjects[0]?.publicRef ?? "");
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
    if (accept && !projectRef()) {
      setError("Choose a project before approving this terminal.");
      return;
    }
    setState("loading");
    setError("");
    try {
      if (accept) await chooseProject(projectRef(), currentReturnTo());
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
            <h1 class="auth-title">Review a Dongo CLI request</h1>
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
            <h1 class="auth-title">Authorize Dongo CLI</h1>
            <p class="auth-lede">Confirm this is the terminal and project you intended to authorize.</p>
          </div>
          <div class="field-group">
            <div class="field-label">Comparison code</div>
            <div class="authorization-card__code" aria-describedby="device-warning">{formatUserCode(loaded().userCode)}</div>
          </div>
          <div class="consent-summary">
            <div class="consent-summary__row"><span class="consent-summary__key">client</span><span class="consent-summary__value">{loaded().clientId === "dongo-cli" ? "Dongo CLI · official client" : loaded().clientId}</span></div>
            <div class="consent-summary__row"><span class="consent-summary__key">account</span><span class="consent-summary__value">{account()}</span></div>
            <div class="consent-summary__row">
              <label class="consent-summary__key" for="device-project">project</label>
              <select class="input consent-summary__select" id="device-project" value={projectRef()} onChange={(event) => setProjectRef(event.currentTarget.value)}>
                <For each={projects()}>{(project) => <option value={project.publicRef}>{project.organizationName} / {project.name}</option>}</For>
              </select>
            </div>
            <div class="consent-summary__row"><span class="consent-summary__key">resource</span><span class="consent-summary__value mono">{loaded().resources.join(", ") || "Dongo agent API"}</span></div>
            <div class="consent-summary__row"><span class="consent-summary__key">status</span><span class="consent-summary__value">{loaded().status}</span></div>
          </div>
          <div class="field-group">
            <div class="field-label">Requested access</div>
            <ul class="scope-list"><For each={loaded().scopes}>{(scope) => <li>{scopeCopy[scope] || scope}</li>}</For></ul>
          </div>
          <Show when={projects().length === 0}><div class="error" role="alert">You do not have an active project that can authorize this terminal.</div></Show>
          <Show when={error()}><div class="error" role="alert">{error()}</div></Show>
          <p class="note" id="device-warning">Approve only if this code matches a terminal in your possession. Do not approve a code sent in a message.</p>
          <div class="consent-actions">
            <button class="button" type="button" onClick={() => void decide(false)}>Deny</button>
            <button class="button button--primary" type="button" disabled={!selectedProject()} onClick={() => void decide(true)}>Approve</button>
          </div>
        </div>
      )}</Show>

      <Show when={state() === "approved" || state() === "denied"}>
        <div class="auth-stack">
          <div class="approved-state">
            <div class="approved-state__title">
              <span style={{ color: state() === "approved" ? "var(--green)" : "var(--danger)" }}>{state() === "approved" ? "✓" : "✕"}</span>
              <span>{state() === "approved" ? "Approved — return to your terminal" : "Authorization denied"}</span>
            </div>
            <p class="auth-lede">{state() === "approved" ? `${selectedProject()?.name ?? "The project"} is approved. Your terminal is finishing secure storage and its connection check; only the terminal will report Connected.` : "No token was issued. You can close this page or restart dongo connect."}</p>
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
