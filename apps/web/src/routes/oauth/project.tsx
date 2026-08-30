import { A, useLocation, useNavigate } from "@solidjs/router";
import { createSignal, For, onMount, Show } from "solid-js";

import { AuthFrame } from "../../components/AuthFrame";
import { humanSession } from "../../lib/auth-client";
import {
  AuthorizationFlowError,
  bridgeAuthorizationSession,
  continueOAuthAfterProject,
  followOAuthResult,
  listAuthorizableProjects,
  selectAuthorizationProject,
  type AuthorizableProject,
} from "../../lib/authorization-client";
import { loginHref } from "../../lib/auth-flow";

export default function OAuthProjectRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const [projects, setProjects] = createSignal<AuthorizableProject[]>([]);
  const [selected, setSelected] = createSignal("");
  const [pending, setPending] = createSignal(true);
  const [error, setError] = createSignal("");
  const returnTo = () => `${location.pathname}${location.search}`;

  onMount(async () => {
    try {
      if (!(await humanSession())) {
        navigate(loginHref(returnTo()), { replace: true });
        return;
      }
      await bridgeAuthorizationSession(returnTo());
      const available = await listAuthorizableProjects();
      setProjects(available);
      setSelected(available[0]?.publicRef ?? "");
    } catch (cause) {
      if (cause instanceof AuthorizationFlowError && cause.code === "authentication_required") {
        navigate(loginHref(returnTo()), { replace: true });
        return;
      }
      setError(cause instanceof AuthorizationFlowError ? cause.message : "The authorization request could not be continued.");
    } finally {
      setPending(false);
    }
  });

  const continueAuthorization = async () => {
    if (!selected()) return;
    setPending(true);
    setError("");
    try {
      await selectAuthorizationProject(selected(), returnTo());
      followOAuthResult(await continueOAuthAfterProject(location.search));
    } catch (cause) {
      setError(cause instanceof AuthorizationFlowError ? cause.message : "The selected project could not be applied.");
      setPending(false);
    }
  };

  return (
    <AuthFrame>
      <Show when={!pending()} fallback={<div class="callback" role="status"><span class="spinner" aria-hidden="true" /><span>Loading your projects…</span></div>}>
        <div class="auth-stack">
          <div class="title-group">
            <div class="eyebrow eyebrow--amber">MCP authorization</div>
            <h1 class="auth-title">Choose one Dongo project</h1>
            <p class="auth-lede">This MCP host receives a separate grant limited to the project you select.</p>
          </div>
          <Show when={projects().length > 0} fallback={
            <div class="auth-stack">
              <div class="error" role="alert">You do not have an active project available for this request.</div>
              <A class="button button--primary button--full" href={`/onboarding?returnTo=${encodeURIComponent(returnTo())}`}>Create a project</A>
            </div>
          }>
            <div class="choice-list" role="radiogroup" aria-label="Project to authorize">
              <For each={projects()}>{(project) => (
                <button class="choice" data-selected={selected() === project.publicRef} type="button" role="radio" aria-checked={selected() === project.publicRef} onClick={() => setSelected(project.publicRef)}>
                  <span class="choice__dot" aria-hidden="true" />
                  <span class="choice__copy"><span class="choice__title">{project.name}</span><span class="choice__body">{project.organizationName} · {project.publicRef}</span></span>
                </button>
              )}</For>
            </div>
            <button class="button button--primary button--full" type="button" disabled={!selected()} onClick={() => void continueAuthorization()}>Continue</button>
          </Show>
          <Show when={error()}><div class="error" role="alert">{error()}</div></Show>
          <p class="security-note">The MCP host cannot switch projects after authorization.</p>
        </div>
      </Show>
    </AuthFrame>
  );
}
