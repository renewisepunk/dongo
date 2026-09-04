import { Meta } from "@solidjs/meta";
import { useNavigate } from "@solidjs/router";
import { onMount } from "solid-js";
import { MarketingHome } from "../features/marketing/MarketingHome";
import { PageTitle } from "../components/PageTitle";
import { humanSession } from "../lib/auth-client";
import { bootstrapHumanIdentity, listAuthorizableProjects } from "../lib/authorization-client";
import { LAST_APP_ROUTE_KEY, safeReturnTo } from "../lib/auth-flow";
import { dongoPageTitle } from "../lib/page-title";

export type IndexRouteDependencies = {
  humanSession: () => Promise<unknown | null>;
  bootstrapHumanIdentity: () => Promise<unknown>;
  listAuthorizableProjects: () => Promise<Array<{
    organizationSlug: string;
    slug: string;
  }>>;
};

export type IndexRouteProps = {
  dependencies?: Partial<IndexRouteDependencies>;
};

export default function IndexRoute(props: IndexRouteProps = {}) {
  const navigate = useNavigate();
  const loadHumanSession = props.dependencies?.humanSession ?? humanSession;
  const bootstrapIdentity = props.dependencies?.bootstrapHumanIdentity ?? bootstrapHumanIdentity;
  const loadProjects = props.dependencies?.listAuthorizableProjects ?? listAuthorizableProjects;

  onMount(async () => {
    const session = await loadHumanSession().catch(() => null);
    if (!session) return;
    try {
      await bootstrapIdentity();
      const lastRoute = safeReturnTo(sessionStorage.getItem(LAST_APP_ROUTE_KEY));
      if (lastRoute) {
        navigate(lastRoute, { replace: true });
        return;
      }
      const firstProject = (await loadProjects())[0];
      navigate(firstProject ? `/app/${firstProject.organizationSlug}/${firstProject.slug}` : "/onboarding", { replace: true });
    } catch {
      // Keep the public entry point usable when the session backend is unavailable.
    }
  });

  return (
    <>
      <PageTitle value={dongoPageTitle("Ideas into visible agent work")} />
      <Meta
        name="description"
        content="Capture ideas, work with coding agents, and keep progress and decisions visible."
      />
      <MarketingHome />
    </>
  );
}
