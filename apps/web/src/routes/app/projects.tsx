import { RequireHumanSession } from "../../components/RequireHumanSession";
import { AllProjectsOverview } from "../../features/overview/AllProjectsOverview";

export default function AllProjectsRoute() {
  return (
    <RequireHumanSession>
      <AllProjectsOverview />
    </RequireHumanSession>
  );
}
