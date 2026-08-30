import { useNavigate } from "@solidjs/router";
import { onMount } from "solid-js";
import { AuthFrame } from "../components/AuthFrame";
import { humanSession } from "../lib/auth-client";
import { bootstrapHumanIdentity, listAuthorizableProjects } from "../lib/authorization-client";
import { LAST_APP_ROUTE_KEY, safeReturnTo } from "../lib/auth-flow";

export default function IndexRoute() {
  const navigate = useNavigate();
  onMount(async () => {
    const session = await humanSession().catch(() => null);
    if (!session) {
      navigate("/login", { replace: true });
      return;
    }
    try {
      await bootstrapHumanIdentity();
      const lastRoute = safeReturnTo(sessionStorage.getItem(LAST_APP_ROUTE_KEY));
      if (lastRoute) {
        navigate(lastRoute, { replace: true });
        return;
      }
      const firstProject = (await listAuthorizableProjects())[0];
      navigate(firstProject ? `/app/${firstProject.organizationSlug}/${firstProject.slug}` : "/onboarding", { replace: true });
    } catch {
      navigate("/login", { replace: true });
    }
  });
  return <AuthFrame><div class="callback" role="status"><span class="spinner" aria-hidden="true" /><span>Checking your session…</span></div></AuthFrame>;
}
