import { PageTitle } from "../components/PageTitle";
import { PublicHelpGuide } from "../features/public-guides/PublicHelpGuide";
import { dongoPageTitle } from "../lib/page-title";

export default function HelpRoute() {
  return <><PageTitle value={dongoPageTitle("Help")} /><PublicHelpGuide /></>;
}
