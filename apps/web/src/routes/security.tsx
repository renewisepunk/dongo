import { Meta, Title } from "@solidjs/meta";
import { SecurityOverview } from "../features/security/SecurityOverview";

export default function SecurityRoute() {
  return (
    <>
      <Title>Security and privacy — dongo</Title>
      <Meta
        name="description"
        content="Learn how dongo keeps repository access local, limits agent connections to approved projects, and protects the work you choose to share."
      />
      <SecurityOverview />
    </>
  );
}
