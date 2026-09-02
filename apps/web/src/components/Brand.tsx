import { A } from "@solidjs/router";

type BrandProps = {
  compact?: boolean;
  href?: string;
};

export function Brand(props: BrandProps) {
  return (
    <A
      classList={{ brand: true, "brand--compact": props.compact }}
      href={props.href ?? "/"}
      aria-label="dongo home"
    >
      <span class="brand__chevron" aria-hidden="true" />
      <span class="brand__name">dongo</span>
      <span class="brand__cursor" aria-hidden="true" />
    </A>
  );
}
