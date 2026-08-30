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

export type LoginRouteDependencies = {
  googleAuthConfigured: boolean;
  humanSession: typeof humanSession;
  requestEmailOtp: typeof requestEmailOtp;
  startGoogleSignIn: typeof startGoogleSignIn;
};

export type LoginRouteProps = {
  dependencies?: Partial<LoginRouteDependencies>;
};

export default function LoginRoute(props: LoginRouteProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams<{ returnTo?: string }>();
  const [email, setEmail] = createSignal("");
  const [error, setError] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const returnTo = () => safeReturnTo(searchParams.returnTo) ?? returnToFromSearch(location.search);
  const providerConfigured = () => props.dependencies?.googleAuthConfigured ?? googleAuthConfigured;
  const loadHumanSession = props.dependencies?.humanSession ?? humanSession;
  const sendEmailOtp = props.dependencies?.requestEmailOtp ?? requestEmailOtp;
  const beginGoogleSignIn = props.dependencies?.startGoogleSignIn ?? startGoogleSignIn;

  onMount(async () => {
    if (await loadHumanSession().catch(() => null)) navigate(callbackHref(returnTo()), { replace: true });
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
      await sendEmailOtp(value);
      sessionStorage.setItem(AUTH_EMAIL_KEY, value);
      navigate(codeHref(returnTo()));
    } catch (cause) {
      setError(safeAuthMessage(cause, "We couldn’t send a code. Try again."));
    } finally {
      setPending(false);
    }
  };

  const continueWithGoogle = async () => {
    if (!providerConfigured() || pending()) return;
    setPending(true);
    setError("");
    try {
      await beginGoogleSignIn(`${window.location.origin}${callbackHref(returnTo())}`);
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
          disabled={!providerConfigured() || pending()}
          aria-describedby={!providerConfigured() ? "google-unavailable" : undefined}
          onClick={continueWithGoogle}
        >
          <span class="mono" aria-hidden="true">G</span>
          <span>{providerConfigured() ? "Continue with Google" : "Google sign-in unavailable"}</span>
        </button>
        <Show when={!providerConfigured()}>
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

        <p class="note">dongo sends a one-time code. There is no password to create or remember.</p>
      </div>
    </AuthFrame>
  );
}
