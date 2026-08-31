import { useParams } from "@solidjs/router";
import { RequireHumanSession } from "../../../../components/RequireHumanSession";
import { HelpGuide } from "../../../../features/help/HelpGuide";

export default function ProjectHelpRoute() {
  const params = useParams<{ orgSlug: string; projectSlug: string }>();
  return <RequireHumanSession><HelpGuide orgSlug={params.orgSlug} projectSlug={params.projectSlug} /></RequireHumanSession>;
}

