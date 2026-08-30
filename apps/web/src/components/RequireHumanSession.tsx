import { useNavigate } from "@solidjs/router";
import { createSignal, onMount, Show, type JSX } from "solid-js";

import { humanSession } from "../lib/auth-client";
import { bootstrapHumanIdentity } from "../lib/authorization-client";
import { LAST_APP_ROUTE_KEY, loginHref } from "../lib/auth-flow";
import { AuthFrame } from "./AuthFrame";

export type RequireHumanSessionDependencies = {
  humanSession: () => Promise<unknown | null>;
  bootstrapHumanIdentity: () => Promise<unknown>;
};

export type RequireHumanSessionProps = {
  children: JSX.Element;
  dependencies?: Partial<RequireHumanSessionDependencies>;
};

export function RequireHumanSession(props: RequireHumanSessionProps) {
  const navigate = useNavigate();
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal(false);
  const loadHumanSession = props.dependencies?.humanSession ?? humanSession;
  const bootstrapIdentity = props.dependencies?.bootstrapHumanIdentity ?? bootstrapHumanIdentity;

  onMount(async () => {
    try {
      const session = await loadHumanSession();
      if (!session) {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        navigate(loginHref(returnTo), { replace: true });
        return;
      }
      await bootstrapIdentity();
      if (window.location.pathname.startsWith("/app/")) {
        sessionStorage.setItem(LAST_APP_ROUTE_KEY, `${window.location.pathname}${window.location.search}`);
      }
      setReady(true);
    } catch {
      setError(true);
    }
  });

  return (
    <Show
      when={ready()}
      fallback={
        <AuthFrame>
          <Show
            when={error()}
            fallback={<div class="callback" role="status"><span class="spinner" aria-hidden="true" /><span>Checking your session…</span></div>}
          >
            <div class="auth-stack">
              <div class="title-group">
                <h1 class="auth-title">We couldn’t check your session</h1>
                <p class="auth-lede">Authentication is temporarily unavailable.</p>
              </div>
              <button class="button button--primary button--full" type="button" onClick={() => window.location.reload()}>Retry</button>
            </div>
          </Show>
        </AuthFrame>
      }
    >
      {props.children}
    </Show>
  );
}
