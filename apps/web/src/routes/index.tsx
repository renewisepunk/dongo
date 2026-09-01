import { Meta, Title } from "@solidjs/meta";
import { useNavigate } from "@solidjs/router";
import { onMount } from "solid-js";
import { MarketingHome } from "../features/marketing/MarketingHome";
import { humanSession } from "../lib/auth-client";
import { bootstrapHumanIdentity, listAuthorizableProjects } from "../lib/authorization-client";
import { LAST_APP_ROUTE_KEY, safeReturnTo } from "../lib/auth-flow";

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
      <Title>dongo — a shared work queue for humans and coding agents</Title>
      <Meta
        name="description"
        content="Give coding agents work, see what they are doing, and answer when they need you—all in one shared work queue."
      />
      <MarketingHome />
    </>
  );
}
