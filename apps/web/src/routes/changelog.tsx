import { PageTitle } from "../components/PageTitle";
import { PublicChangelog } from "../features/public-guides/PublicChangelog";
import { dongoPageTitle } from "../lib/page-title";

export default function ChangelogRoute() {
  return <><PageTitle value={dongoPageTitle("Changelog")} /><PublicChangelog /></>;
}
