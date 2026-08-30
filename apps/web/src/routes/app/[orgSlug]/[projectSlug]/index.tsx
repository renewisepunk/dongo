import { useParams } from "@solidjs/router";
import { RequireHumanSession } from "../../../../components/RequireHumanSession";
import { Overview } from "../../../../features/overview/Overview";

export default function ProjectOverviewRoute() {
  const params = useParams<{ orgSlug: string; projectSlug: string }>();
  return <RequireHumanSession><Overview orgSlug={params.orgSlug} projectSlug={params.projectSlug} /></RequireHumanSession>;
}
