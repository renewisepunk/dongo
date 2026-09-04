import { PageTitle } from "../components/PageTitle";
import { GetStartedGuide } from "../features/public-guides/GetStartedGuide";
import { dongoPageTitle } from "../lib/page-title";

export default function GetStartedRoute() {
  return <><PageTitle value={dongoPageTitle("Get started")} /><GetStartedGuide /></>;
}
