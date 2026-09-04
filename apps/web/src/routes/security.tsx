import { Meta } from "@solidjs/meta";
import { PageTitle } from "../components/PageTitle";
import { SecurityOverview } from "../features/security/SecurityOverview";
import { dongoPageTitle } from "../lib/page-title";

export default function SecurityRoute() {
  return (
    <>
      <PageTitle value={dongoPageTitle("Security and privacy")} />
      <Meta
        name="description"
        content="Learn how dongo keeps repository access local, limits agent connections to approved projects, and protects the work you choose to share."
      />
      <SecurityOverview />
    </>
  );
}
