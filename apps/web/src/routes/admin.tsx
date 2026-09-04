import { Meta } from "@solidjs/meta";
import { PageTitle } from "../components/PageTitle";
import { RequireHumanSession } from "../components/RequireHumanSession";
import { PlatformAdmin } from "../features/admin/PlatformAdmin";
import { dongoPageTitle } from "../lib/page-title";

export default function PlatformAdminRoute() {
  return (
    <RequireHumanSession>
      <PageTitle value={dongoPageTitle("Platform administration")} />
      <Meta name="robots" content="noindex,nofollow,noarchive" />
      <PlatformAdmin />
    </RequireHumanSession>
  );
}
