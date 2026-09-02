import { useParams } from "@solidjs/router";
import { RequireHumanSession } from "../../../../components/RequireHumanSession";
import { UpgradePlan } from "../../../../features/admin/UpgradePlan";

export default function UpgradePlanRoute() {
  const params = useParams<{ orgSlug: string; projectSlug: string }>();
  return <RequireHumanSession><UpgradePlan orgSlug={params.orgSlug} projectSlug={params.projectSlug} /></RequireHumanSession>;
}
