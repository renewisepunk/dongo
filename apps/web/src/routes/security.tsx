import { Meta, Title } from "@solidjs/meta";
import { SecurityOverview } from "../features/security/SecurityOverview";

export default function SecurityRoute() {
  return (
    <>
      <Title>Security + data boundary — dongo</Title>
      <Meta
        name="description"
        content="Inspect dongo's repository boundary, project-scoped authorization, data retention, infrastructure, current assurance, and private vulnerability-reporting process."
      />
      <SecurityOverview />
    </>
  );
}

