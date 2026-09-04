import { useParams } from "@solidjs/router";
import { RequireHumanSession } from "../../../../components/RequireHumanSession";
import { HelpGuide } from "../../../../features/help/HelpGuide";
import { ProjectDataConnection } from "../../../../lib/project-data";

export default function ProjectHelpRoute() {
  const params = useParams<{ orgSlug: string; projectSlug: string }>();
  return (
    <RequireHumanSession>
      <HelpGuide
        orgSlug={params.orgSlug}
        projectSlug={params.projectSlug}
        resolveProjectName={async (orgSlug, projectSlug) => {
          const connection = await ProjectDataConnection.connect(orgSlug, projectSlug);
          try {
            return connection.projectName;
          } finally {
            await connection.close();
          }
        }}
      />
    </RequireHumanSession>
  );
}
