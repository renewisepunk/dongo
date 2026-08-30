import { useParams } from "@solidjs/router";
import { RequireHumanSession } from "../../../../components/RequireHumanSession";
import { ProjectSettings } from "../../../../features/admin/ProjectSettings";

export default function ProjectSettingsRoute() {
  const params = useParams<{ orgSlug: string; projectSlug: string }>();
  return <RequireHumanSession><ProjectSettings orgSlug={params.orgSlug} projectSlug={params.projectSlug} /></RequireHumanSession>;
}
