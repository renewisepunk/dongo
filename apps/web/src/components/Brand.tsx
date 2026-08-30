import { A } from "@solidjs/router";

type BrandProps = {
  compact?: boolean;
  href?: string;
};

export function Brand(props: BrandProps) {
  return (
    <A class="brand" href={props.href ?? "/"} aria-label="Dongo home">
      <span class="brand__chevron" style={{ "font-size": props.compact ? "18px" : undefined }}>
        ❯
      </span>
      <span class="brand__name" style={{ "font-size": props.compact ? "16px" : undefined }}>
        dongo
      </span>
      <span class="brand__cursor" aria-hidden="true" style={{ "font-size": props.compact ? "14px" : undefined }}>
        ▌
      </span>
    </A>
  );
}
