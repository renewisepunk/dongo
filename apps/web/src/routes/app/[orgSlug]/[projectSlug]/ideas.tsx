import { useParams } from "@solidjs/router";

import { RequireHumanSession } from "../../../../components/RequireHumanSession";
import { Ideas } from "../../../../features/ideas/Ideas";

export default function IdeasRoute() {
  const params = useParams<{ orgSlug: string; projectSlug: string }>();
  return <RequireHumanSession><Ideas orgSlug={params.orgSlug} projectSlug={params.projectSlug} /></RequireHumanSession>;
}
