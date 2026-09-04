import { useLocation, useNavigate, useSearchParams } from "@solidjs/router";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";

import { AuthFrame } from "../../components/AuthFrame";
import { PageTitle } from "../../components/PageTitle";
import { lowercaseDongoBrand } from "../../lib/brand-case";
import { humanSession } from "../../lib/auth-client";
import {
  AuthorizationFlowError,
  bridgeAuthorizationSession,
  decideOAuthConsent,
  followOAuthResult,
  getOAuthClientSummary,
  listAuthorizableProjects,
  selectAuthorizationProject,
  type AuthorizableProject,
  type OAuthClientSummary,
} from "../../lib/authorization-client";
import { loginHref, signedOAuthQuery } from "../../lib/auth-flow";
import { dongoPageTitle } from "../../lib/page-title";

const scopeCopy: Record<string, string> = {
  "dongo:work:read": "Read project context, work, comments, and attachment metadata.",
  "dongo:work:write": "Create, claim, update, and finish work for this project.",
  "dongo:attachments:read": "Download project attachments when explicitly requested.",
  offline_access: "Keep this host authorized until its grant is revoked.",
};

export type OAuthConsentRouteDependencies = {
  humanSession: () => Promise<{
    user: { email?: string; name: string };
  } | null>;
  bridgeAuthorizationSession: typeof bridgeAuthorizationSession;
  getOAuthClientSummary: typeof getOAuthClientSummary;
  listAuthorizableProjects: typeof listAuthorizableProjects;
  selectAuthorizationProject: typeof selectAuthorizationProject;
  decideOAuthConsent: typeof decideOAuthConsent;
  followOAuthResult: typeof followOAuthResult;
};

export type OAuthConsentRouteProps = {
  dependencies?: Partial<OAuthConsentRouteDependencies>;
};

export default function OAuthConsentRoute(props: OAuthConsentRouteProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams<{ client_id?: string; scope?: string }>();
  const [client, setClient] = createSignal<OAuthClientSummary>();
  const [projects, setProjects] = createSignal<AuthorizableProject[]>([]);
  const [projectRef, setProjectRef] = createSignal("");
  const [state, setState] = createSignal<"loading" | "review" | "submitting" | "error">("loading");
  const [error, setError] = createSignal("");
  const loadHumanSession = props.dependencies?.humanSession ?? humanSession;
  const bridgeSession = props.dependencies?.bridgeAuthorizationSession ?? bridgeAuthorizationSession;
  const loadClient = props.dependencies?.getOAuthClientSummary ?? getOAuthClientSummary;
  const loadProjects = props.dependencies?.listAuthorizableProjects ?? listAuthorizableProjects;
  const chooseProject = props.dependencies?.selectAuthorizationProject ?? selectAuthorizationProject;
  const saveConsent = props.dependencies?.decideOAuthConsent ?? decideOAuthConsent;
  const followOAuth = props.dependencies?.followOAuthResult ?? followOAuthResult;
  const returnTo = () => `${location.pathname}${location.search}`;
  const selectedProject = createMemo(() => projects().find((project) => project.publicRef === projectRef()));
  const requestParameters = createMemo(() => {
    const signed = signedOAuthQuery(location.search);
    return new URLSearchParams(signed ?? location.search);
  });
  const clientId = createMemo(() => requestParameters().get("client_id") ?? searchParams.client_id);
  const scopes = createMemo(() => requestParameters().get("scope")?.split(/\s+/).filter(Boolean) ?? []);

  onMount(async () => {
    try {
      const session = await loadHumanSession();
      if (!session) {
        navigate(loginHref(returnTo()), { replace: true });
        return;
      }
      await bridgeSession(returnTo());
      if (!clientId()) throw new AuthorizationFlowError("invalid", "This request does not identify an OAuth client.");
      const [summary, availableProjects] = await Promise.all([
        loadClient(clientId()!),
        loadProjects(),
      ]);
      setClient(summary);
      setProjects(availableProjects);
      setProjectRef(availableProjects[0]?.publicRef ?? "");
      setState("review");
    } catch (cause) {
      if (cause instanceof AuthorizationFlowError && cause.code === "authentication_required") {
        navigate(loginHref(returnTo()), { replace: true });
        return;
      }
      setError(cause instanceof AuthorizationFlowError ? cause.message : "This OAuth request could not be loaded.");
      setState("error");
    }
  });

  const decide = async (accept: boolean) => {
    if (accept && !projectRef()) {
      setError("Choose a project before allowing access.");
      return;
    }
    setState("submitting");
    setError("");
    try {
      if (accept) await chooseProject(projectRef(), returnTo());
      followOAuth(await saveConsent(location.search, accept));
    } catch (cause) {
      setError(cause instanceof AuthorizationFlowError ? cause.message : "The authorization decision could not be saved.");
      setState("review");
    }
  };

  return (
    <AuthFrame>
      <PageTitle value={dongoPageTitle(state() === "error" ? "Authorization unavailable" : "Authorize access")} />
      <Show when={state() !== "loading" && state() !== "submitting"} fallback={<div class="callback" role="status"><span class="spinner" aria-hidden="true" /><span>{state() === "submitting" ? "Saving your decision…" : "Checking the OAuth request…"}</span></div>}>
        <Show when={state() === "review" && client()} fallback={
          <div class="auth-stack">
            <div class="title-group"><h1 class="auth-title">This request can’t be authorized</h1><p class="auth-lede">{error()}</p></div>
            <button class="button button--primary button--full" type="button" onClick={() => window.location.reload()}>Try again</button>
            <p class="note">Return to your MCP host and restart login if the request expired.</p>
          </div>
        }>{(loadedClient) => (
          <div class="auth-stack">
            <div class="title-group">
              <div class="eyebrow eyebrow--amber">Optional MCP connection</div>
              <h1 class="auth-title">Allow {lowercaseDongoBrand(loadedClient().name)} to use dongo?</h1>
              <p class="auth-lede">Approve direct dongo tools for one project. The CLI works without this optional connection.</p>
            </div>
            <div class="consent-summary">
              <div class="consent-summary__row"><span class="consent-summary__key">agent</span><span class="consent-summary__value">{lowercaseDongoBrand(loadedClient().name)}</span></div>
              <div class="consent-summary__row">
                <label class="consent-summary__key" for="oauth-project">project</label>
                <select class="input consent-summary__select" id="oauth-project" value={projectRef()} onChange={(event) => setProjectRef(event.currentTarget.value)}>
                  <For each={projects()}>{(project) => <option value={project.publicRef}>{project.organizationName} / {project.name}</option>}</For>
                </select>
              </div>
            </div>
            <ul class="scope-list"><For each={scopes()}>{(scope) => <li>{scopeCopy[scope] || scope}</li>}</For></ul>
            <Show when={projects().length === 0}><div class="error" role="alert">You do not have an active project available for this request.</div></Show>
            <Show when={error()}><div class="error" role="alert">{error()}</div></Show>
            <p class="note">{lowercaseDongoBrand(loadedClient().name)} cannot use a CLI token, access another project, or choose its own dongo actor identity.</p>
            <div class="consent-actions">
              <button class="button button--primary button--full" type="button" disabled={!selectedProject()} onClick={() => void decide(true)}>Approve MCP access</button>
              <button class="button button--quiet" type="button" onClick={() => void decide(false)}>Deny</button>
            </div>
          </div>
        )}</Show>
      </Show>
    </AuthFrame>
  );
}
