import { useNavigate } from "@solidjs/router";
import { onMount } from "solid-js";
import { AuthFrame } from "../components/AuthFrame";
import { PageTitle } from "../components/PageTitle";
import { humanSession } from "../lib/auth-client";
import { bootstrapHumanIdentity, listAuthorizableProjects } from "../lib/authorization-client";
import { LAST_APP_ROUTE_KEY, safeReturnTo } from "../lib/auth-flow";
import { dongoPageTitle } from "../lib/page-title";

export type OpenRouteDependencies = {
  humanSession: () => Promise<unknown | null>;
  bootstrapHumanIdentity: () => Promise<unknown>;
  listAuthorizableProjects: () => Promise<Array<{
    organizationSlug: string;
    slug: string;
  }>>;
};

export type OpenRouteProps = {
  dependencies?: Partial<OpenRouteDependencies>;
};

export default function OpenRoute(props: OpenRouteProps = {}) {
  const navigate = useNavigate();
  const loadHumanSession = props.dependencies?.humanSession ?? humanSession;
  const bootstrapIdentity = props.dependencies?.bootstrapHumanIdentity ?? bootstrapHumanIdentity;
  const loadProjects = props.dependencies?.listAuthorizableProjects ?? listAuthorizableProjects;

  onMount(async () => {
    const session = await loadHumanSession().catch(() => null);
    if (!session) {
      navigate("/login", { replace: true });
      return;
    }
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
      navigate("/login", { replace: true });
    }
  });

  return <AuthFrame><PageTitle value={dongoPageTitle("Opening dongo")} /><div class="callback" role="status"><span class="spinner" aria-hidden="true" /><span>Checking your session…</span></div></AuthFrame>;
}
