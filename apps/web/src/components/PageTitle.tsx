import { Title } from "@solidjs/meta";
import { createEffect, onCleanup } from "solid-js";
import { isServer } from "solid-js/web";

export function PageTitle(props: { value: string }) {
  const previousTitle = typeof document === "undefined" ? undefined : document.title;
  let appliedTitle: string | undefined;

  createEffect(() => {
    const nextTitle = props.value;
    appliedTitle = nextTitle;
    if (typeof document !== "undefined") document.title = nextTitle;
  });

  onCleanup(() => {
    if (
      typeof document !== "undefined" &&
      previousTitle !== undefined &&
      appliedTitle !== undefined &&
      document.title === appliedTitle
    ) {
      document.title = previousTitle;
    }
  });

  return isServer ? <Title>{props.value}</Title> : null;
}
