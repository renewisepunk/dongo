import { Title } from "@solidjs/meta";

export function PageTitle(props: { value: string }) {
  return <Title>{props.value}</Title>;
}
