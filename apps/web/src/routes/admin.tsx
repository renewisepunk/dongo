import { Meta, Title } from "@solidjs/meta";
import { RequireHumanSession } from "../components/RequireHumanSession";
import { PlatformAdmin } from "../features/admin/PlatformAdmin";

export default function PlatformAdminRoute() {
  return (
    <RequireHumanSession>
      <Title>platform administration — dongo</Title>
      <Meta name="robots" content="noindex,nofollow,noarchive" />
      <PlatformAdmin />
    </RequireHumanSession>
  );
}
