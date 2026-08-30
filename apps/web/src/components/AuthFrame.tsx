import type { ParentProps } from "solid-js";
import { Brand } from "./Brand";

export function AuthFrame(props: ParentProps) {
  return (
    <main class="auth-page">
      <section class="auth-card">
        <Brand />
        {props.children}
      </section>
    </main>
  );
}
