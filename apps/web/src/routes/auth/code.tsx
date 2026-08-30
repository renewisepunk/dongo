import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { AuthFrame } from "../../components/AuthFrame";
import { requestEmailOtp, verifyEmailOtp } from "../../lib/auth-client";
import { AUTH_EMAIL_KEY, callbackHref, loginHref, normalizeOtp, safeAuthMessage, safeReturnTo } from "../../lib/auth-flow";

export type EmailCodeRouteDependencies = {
  requestEmailOtp: typeof requestEmailOtp;
  verifyEmailOtp: typeof verifyEmailOtp;
  resendCooldownSeconds: number;
};

export type EmailCodeRouteProps = {
  dependencies?: Partial<EmailCodeRouteDependencies>;
};

export default function EmailCodeRoute(props: EmailCodeRouteProps = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams<{ returnTo?: string }>();
  const [code, setCode] = createSignal("");
  const [error, setError] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [resendIn, setResendIn] = createSignal(
    props.dependencies?.resendCooldownSeconds ?? 30,
  );
  const sendEmailOtp = props.dependencies?.requestEmailOtp ?? requestEmailOtp;
  const confirmEmailOtp = props.dependencies?.verifyEmailOtp ?? verifyEmailOtp;
  const returnTo = () => safeReturnTo(searchParams.returnTo);
  const email = typeof sessionStorage === "undefined"
    ? "your email"
    : sessionStorage.getItem(AUTH_EMAIL_KEY) ?? "";

  onMount(() => {
    if (!email) {
      navigate(loginHref(returnTo()), { replace: true });
      return;
    }
    const timer = window.setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1_000);
    onCleanup(() => window.clearInterval(timer));
  });

  const verify = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!/^[A-Z0-9]{6}$/.test(code()) || !email) {
      setError("Enter the six-character code from your email.");
      return;
    }
    setPending(true);
    setError("");
    setStatus("Verifying…");
    try {
      await confirmEmailOtp(email, code());
      navigate(callbackHref(returnTo()), { replace: true });
    } catch (cause) {
      setError(safeAuthMessage(cause, "We couldn’t verify that code."));
      setStatus("");
    } finally {
      setPending(false);
    }
  };

  const resend = async () => {
    if (resendIn() > 0 || pending() || !email) return;
    setPending(true);
    setError("");
    try {
      await sendEmailOtp(email);
      setResendIn(props.dependencies?.resendCooldownSeconds ?? 30);
      setStatus("A new code was sent.");
    } catch (cause) {
      setError(safeAuthMessage(cause, "We couldn’t resend the code."));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthFrame>
      <form class="auth-stack" onSubmit={verify} novalidate>
        <A class="button button--quiet" href={loginHref(returnTo())}>← back to sign in</A>
        <div class="title-group">
          <h1 class="auth-title">Check your email</h1>
          <p class="auth-lede">We sent a six-character code to <span style={{ color: "var(--text)" }}>{email}</span>.</p>
        </div>
        <div class="field-group">
          <label class="field-label" for="dongo-code">One-time code</label>
          <input
            class="input input--code"
            id="dongo-code"
            inputmode="text"
            autocomplete="one-time-code"
            maxlength={6}
            value={code()}
            onInput={(event) => {
              setCode(normalizeOtp(event.currentTarget.value));
              setError("");
            }}
            placeholder="A4K2QP"
            aria-invalid={Boolean(error())}
          />
          <Show when={error()}><div class="error" role="alert">{error()}</div></Show>
          <button class="button button--primary button--full" type="submit" disabled={pending()}>{pending() ? "Verifying…" : "Verify"}</button>
        </div>
        <Show when={status()}><p class="security-note" role="status">{status()}</p></Show>
        <div class="inline-actions">
          <button class="button button--quiet" type="button" disabled={resendIn() > 0 || pending()} onClick={resend}>
            {resendIn() > 0 ? `Resend in ${resendIn()}s` : "Resend code"}
          </button>
          <A class="button button--quiet" href={loginHref(returnTo())}>Change email</A>
        </div>
      </form>
    </AuthFrame>
  );
}
