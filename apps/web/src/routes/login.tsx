import { useLocation, useNavigate, useSearchParams } from "@solidjs/router";
import { createSignal, onMount, Show } from "solid-js";
import { AuthFrame } from "../components/AuthFrame";
import { googleAuthConfigured } from "../lib/auth-config";
import { humanSession, requestEmailOtp, startGoogleSignIn } from "../lib/auth-client";
import {
  AUTH_EMAIL_KEY,
  callbackHref,
  codeHref,
  normalizeEmail,
  returnToFromSearch,
  safeAuthMessage,
  safeReturnTo,
} from "../lib/auth-flow";

export default function LoginRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams<{ returnTo?: string }>();
  const [email, setEmail] = createSignal("");
  const [error, setError] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const returnTo = () => safeReturnTo(searchParams.returnTo) ?? returnToFromSearch(location.search);

  onMount(async () => {
    if (await humanSession().catch(() => null)) navigate(callbackHref(returnTo()), { replace: true });
  });

  const continueWithEmail = async (event: SubmitEvent) => {
    event.preventDefault();
    const value = normalizeEmail(email());
    if (!value) {
      setError("Enter a valid email address.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await requestEmailOtp(value);
      sessionStorage.setItem(AUTH_EMAIL_KEY, value);
      navigate(codeHref(returnTo()));
    } catch (cause) {
      setError(safeAuthMessage(cause, "We couldn’t send a code. Try again."));
    } finally {
      setPending(false);
    }
  };

  const continueWithGoogle = async () => {
    if (!googleAuthConfigured || pending()) return;
    setPending(true);
    setError("");
    try {
      await startGoogleSignIn(`${window.location.origin}${callbackHref(returnTo())}`);
    } catch (cause) {
      setError(safeAuthMessage(cause, "Google sign-in could not be started."));
      setPending(false);
    }
  };

  return (
    <AuthFrame>
      <div class="auth-stack auth-stack--roomy">
        <p class="auth-promise">
          See what your coding agents are doing, give them work, and answer when they need you.
        </p>

        <button
          class="button button--primary button--full"
          type="button"
          disabled={!googleAuthConfigured || pending()}
          aria-describedby={!googleAuthConfigured ? "google-unavailable" : undefined}
          onClick={continueWithGoogle}
        >
          <span class="mono" aria-hidden="true">G</span>
          <span>{googleAuthConfigured ? "Continue with Google" : "Google sign-in unavailable"}</span>
        </button>
        <Show when={!googleAuthConfigured}>
          <p class="note" id="google-unavailable">Google has not been configured for this environment. Use an email code instead.</p>
        </Show>

        <div class="divider">or</div>

        <form class="field-group" onSubmit={continueWithEmail} novalidate>
          <label class="field-label" for="dongo-email">Email address</label>
          <input
            class="input"
            id="dongo-email"
            type="email"
            autocomplete="email"
            value={email()}
            onInput={(event) => {
              setEmail(event.currentTarget.value);
              setError("");
            }}
            placeholder="rene@studio.dev"
            aria-describedby={error() ? "email-error" : undefined}
            aria-invalid={Boolean(error())}
          />
          <Show when={error()}>
            <div class="error" id="email-error" role="alert">{error()}</div>
          </Show>
          <button class="button button--full" type="submit" disabled={pending()}>{pending() ? "Sending code…" : "Continue with email"}</button>
        </form>

        <p class="note">Dongo sends a one-time code. There is no password to create or remember.</p>
      </div>
    </AuthFrame>
  );
}
