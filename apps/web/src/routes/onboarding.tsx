import { useNavigate, useSearchParams } from "@solidjs/router";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { AuthFrame } from "../components/AuthFrame";
import { RequireHumanSession } from "../components/RequireHumanSession";
import { SignOutButton } from "../components/SignOutButton";
import { humanSession } from "../lib/auth-client";
import { AuthorizationFlowError, createFirstProject } from "../lib/authorization-client";
import { personalOrganizationSlug, safeReturnTo } from "../lib/auth-flow";
import { slugify } from "../lib/slug";

type ExecutionMode = "manual" | "autonomous";

export type OnboardingRouteDependencies = {
  humanSession: () => Promise<{
    user: { id: string; name?: string; email?: string };
  } | null>;
  bootstrapHumanIdentity: () => Promise<unknown>;
  createFirstProject: typeof createFirstProject;
};

export type OnboardingRouteProps = {
  dependencies?: Partial<OnboardingRouteDependencies>;
};

export default function OnboardingRoute(props: OnboardingRouteProps = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams<{ returnTo?: string }>();
  const [name, setName] = createSignal("");
  const [repositoryUrl, setRepositoryUrl] = createSignal("");
  const [organizationSlug, setOrganizationSlug] = createSignal("workspace");
  const [mode, setMode] = createSignal<ExecutionMode>("manual");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const slug = createMemo(() => slugify(name()));
  const loadHumanSession = props.dependencies?.humanSession ?? humanSession;
  const provisionFirstProject = props.dependencies?.createFirstProject ?? createFirstProject;

  onMount(async () => {
    const session = await loadHumanSession();
    if (!session) return;
    setOrganizationSlug(personalOrganizationSlug({
      name: session.user.name,
      email: session.user.email,
      userId: session.user.id,
    }));
  });

  const createProject = async (event: SubmitEvent) => {
    event.preventDefault();
    const projectName = name().trim();
    if (!projectName || !slug()) {
      setError("Enter a project name.");
      return;
    }
    let normalizedRepositoryUrl: string | undefined;
    const repository = repositoryUrl().trim();
    if (repository) {
      try {
        const parsed = new URL(repository.includes("://") ? repository : `https://${repository}`);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
        normalizedRepositoryUrl = parsed.toString();
      } catch {
        setError("Enter a valid HTTP or HTTPS repository URL.");
        return;
      }
    }
    setPending(true);
    setError("");
    try {
      const session = await loadHumanSession();
      if (!session) throw new AuthorizationFlowError("authentication_required", "Sign in again to create this project.");
      const project = await provisionFirstProject({
        user: { id: session.user.id, name: session.user.name, email: session.user.email },
        name: projectName,
        slug: slug(),
        repositoryUrl: normalizedRepositoryUrl,
        executionMode: mode(),
      });
      sessionStorage.setItem("dongo:project", JSON.stringify({
        name: projectName,
        slug: slug(),
        repositoryUrl: normalizedRepositoryUrl,
        mode: mode(),
        publicRef: project.publicRef,
        projectId: project.projectId,
        organizationId: project.organizationId,
        organizationSlug: project.organizationSlug,
      }));
      navigate(safeReturnTo(searchParams.returnTo) ?? "/connect", { replace: true });
    } catch (cause) {
      setError(cause instanceof AuthorizationFlowError ? cause.message : "The project could not be created. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <RequireHumanSession dependencies={props.dependencies}><AuthFrame>
      <form class="auth-stack" onSubmit={createProject}>
        <div class="title-group">
          <div class="eyebrow eyebrow--amber">Set up your workspace</div>
          <h1 class="auth-title">Create your first project</h1>
          <p class="auth-lede">A project maps to one repository or codebase.</p>
        </div>

        <div class="field-group">
          <label class="field-label" for="project-name">Project name</label>
          <input
            class="input"
            id="project-name"
            required
            value={name()}
            onInput={(event) => { setName(event.currentTarget.value); setError(""); }}
            placeholder="Checkout service"
          />
          <div class="slug-preview">dev.dongo.so/{organizationSlug()}/{slug()}</div>
        </div>

        <div class="field-group">
          <label class="field-label" for="repository-url">
            Repository URL <span class="field-label__optional">optional</span>
          </label>
          <input
            class="input mono"
            id="repository-url"
            value={repositoryUrl()}
            onInput={(event) => { setRepositoryUrl(event.currentTarget.value); setError(""); }}
            placeholder="github.com/rene/checkout"
          />
        </div>

        <div class="choice-list" role="radiogroup" aria-labelledby="execution-mode-label">
          <div class="field-label" id="execution-mode-label">Agent execution mode</div>
          <button
            class="choice"
            data-selected={mode() === "manual"}
            type="button"
            role="radio"
            aria-checked={mode() === "manual"}
            onClick={() => setMode("manual")}
          >
            <span class="choice__dot" aria-hidden="true" />
            <span class="choice__copy">
              <span class="choice__title">Manual</span>
              <span class="choice__body">Agents triage and suggest work, then wait for you.</span>
            </span>
          </button>
          <button
            class="choice"
            data-selected={mode() === "autonomous"}
            type="button"
            role="radio"
            aria-checked={mode() === "autonomous"}
            onClick={() => setMode("autonomous")}
          >
            <span class="choice__dot" aria-hidden="true" />
            <span class="choice__copy">
              <span class="choice__title">Autonomous</span>
              <span class="choice__body">Agents may claim and begin Ready work.</span>
            </span>
          </button>
        </div>

        <Show when={error()}><div class="error" role="alert">{error()}</div></Show>
        <button class="button button--primary button--full" type="submit" disabled={pending()}>{pending() ? "Creating project…" : "Create project"}</button>
        <SignOutButton />
        <p class="note">Free plan includes one active project.</p>
      </form>
    </AuthFrame></RequireHumanSession>
  );
}
