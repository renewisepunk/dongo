import { Meta, Title } from "@solidjs/meta";
import { MarketingHome } from "../features/marketing/MarketingHome";

export default function IndexRoute() {
  return (
    <>
      <Title>dongo — a shared work queue for humans and coding agents</Title>
      <Meta
        name="description"
        content="Give coding agents work, see what they are doing, and answer when they need you—all in one shared work queue."
      />
      <MarketingHome />
    </>
  );
}
