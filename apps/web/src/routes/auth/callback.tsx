import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { createSignal, onMount, Show } from "solid-js";
import { AuthFrame } from "../../components/AuthFrame";
import { consumeCrossDomainOneTimeToken, humanSession } from "../../lib/auth-client";
import { bootstrapHumanIdentity, bridgeAuthorizationSession, listAuthorizableProjects } from "../../lib/authorization-client";
import { isAuthorizationReturnTo, LAST_APP_ROUTE_KEY, safeReturnTo } from "../../lib/auth-flow";

export default function AuthCallbackRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams<{ returnTo?: string }>();
  const [error, setError] = createSignal("");

  onMount(async () => {
    const returnTo = safeReturnTo(searchParams.returnTo);
    try {
      await consumeCrossDomainOneTimeToken();
      if (!(await humanSession())) throw new Error("missing session");
      await bootstrapHumanIdentity();
      if (isAuthorizationReturnTo(returnTo)) {
        const bridgedReturnTo = safeReturnTo(await bridgeAuthorizationSession(returnTo!));
        if (!bridgedReturnTo) throw new Error("invalid return path");
        window.location.assign(bridgedReturnTo);
        return;
      }
      const directDestination = safeReturnTo(returnTo) || safeReturnTo(sessionStorage.getItem(LAST_APP_ROUTE_KEY));
      if (directDestination) {
        navigate(directDestination, { replace: true });
        return;
      }
      const firstProject = (await listAuthorizableProjects())[0];
      navigate(firstProject ? `/app/${firstProject.organizationSlug}/${firstProject.slug}` : "/onboarding", { replace: true });
    } catch {
      setError("Your sign-in finished, but Dongo could not establish the browser session.");
    }
  });

  return (
    <AuthFrame>
      <Show when={error()} fallback={<div class="callback" role="status" aria-live="polite"><div class="spinner" aria-hidden="true" /><span>Signing you in…</span></div>}>
        <div class="auth-stack">
          <div class="title-group"><h1 class="auth-title">We couldn’t complete sign-in</h1><p class="auth-lede">{error()}</p></div>
          <button class="button button--primary button--full" type="button" onClick={() => window.location.reload()}>Try again</button>
          <A class="button button--quiet" href="/login">Back to sign in</A>
        </div>
      </Show>
    </AuthFrame>
  );
}
