import { useNavigate } from "@solidjs/router";
import { createSignal } from "solid-js";
import type { JSX } from "solid-js";

import { signOutEverywhere } from "../lib/auth-client";
import { AUTH_EMAIL_KEY, LAST_APP_ROUTE_KEY } from "../lib/auth-flow";

export function SignOutButton(props: { class?: string; role?: JSX.AriaAttributes["role"] }) {
  const navigate = useNavigate();
  const [pending, setPending] = createSignal(false);

  const signOut = async () => {
    if (pending()) return;
    setPending(true);
    try {
      await signOutEverywhere();
      sessionStorage.removeItem(AUTH_EMAIL_KEY);
      sessionStorage.removeItem(LAST_APP_ROUTE_KEY);
      navigate("/login", { replace: true });
    } catch {
      setPending(false);
    }
  };

  return <button class={props.class ?? "button button--quiet"} type="button" role={props.role} disabled={pending()} onClick={() => void signOut()}>{pending() ? "Signing out…" : "Sign out"}</button>;
}
