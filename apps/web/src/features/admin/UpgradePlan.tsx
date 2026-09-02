import { A } from "@solidjs/router";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Brand } from "../../components/Brand";
import { SignOutButton } from "../../components/SignOutButton";
import {
  ProjectDataConnection,
  type ProjectAdministration,
} from "../../lib/project-data";
import { PLANNED_UNLIMITED_PLAN, projectCreationAction } from "../../lib/plans";
import "./admin.css";

type UpgradePlanConnection = {
  getAdministration: () => Promise<ProjectAdministration>;
  close: () => Promise<void>;
};

export type UpgradePlanDependencies = {
  connectForSettings: (
    organizationSlug: string,
    projectSlug: string,
  ) => Promise<UpgradePlanConnection>;
};

export type UpgradePlanProps = {
  orgSlug: string;
  projectSlug: string;
  dependencies?: Partial<UpgradePlanDependencies>;
};

export function UpgradePlan(props: UpgradePlanProps) {
  const [administration, setAdministration] = createSignal<ProjectAdministration>();
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  let connection: UpgradePlanConnection | undefined;
  let disposed = false;
  const connectForSettings = props.dependencies?.connectForSettings ??
    ProjectDataConnection.connectForSettings;

  const creationAction = createMemo(() => {
    const admin = administration();
    if (!admin) return undefined;
    return projectCreationAction({
      plan: admin.organization.plan,
      activeProjectCount: admin.activeProjectCount,
      activeProjectLimit: admin.projectAllowance.limit ?? null,
      projectCapacitySource: admin.projectAllowance.source,
      canCreateProject: admin.projectAllowance.canCreate,
    }, admin.organization.slug, admin.project.slug);
  });

  onMount(() => {
    void connectForSettings(props.orgSlug, props.projectSlug)
      .then(async (connected) => {
        if (disposed) {
          await connected.close();
          return;
        }
        connection = connected;
        const next = await connected.getAdministration();
        if (disposed) return;
        setAdministration(next);
        setLoading(false);
      })
      .catch(() => {
        setError("This organization’s plan could not be loaded for your account.");
        setLoading(false);
      });
  });

  onCleanup(() => {
    disposed = true;
    void connection?.close();
  });

  return (
    <main class="settings-page">
      <header class="settings-header">
        <Brand compact href={`/app/${props.orgSlug}/${props.projectSlug}`} />
        <div class="settings-header__title">/ {props.projectSlug} / upgrade</div>
        <div style={{ flex: 1 }} />
        <A class="button button--quiet" href={`/app/${props.orgSlug}/${props.projectSlug}/settings?tab=Plan%20%26%20storage`}>Plan &amp; storage</A>
        <SignOutButton />
      </header>

      <div class="upgrade-layout">
        <Show when={loading()}><div class="note" role="status">Loading plan details…</div></Show>
        <Show when={error()}><div class="error" role="alert">{error()}</div></Show>
        <Show when={!loading() ? administration() : undefined}>{(admin) => (
          <>
            <div class="upgrade-hero">
              <div class="eyebrow eyebrow--amber">dongo plans</div>
              <h1 class="upgrade-title">Make room for every project.</h1>
              <p class="upgrade-lede">The planned Unlimited plan removes the active-project ceiling for {admin().organization.name} and keeps collaboration open as the team grows.</p>
            </div>

            <div class="upgrade-grid">
              <section class="upgrade-offer" aria-labelledby="upgrade-offer-title">
                <div class="upgrade-offer__heading">
                  <div>
                    <div class="upgrade-offer__kicker">Planned offer</div>
                    <h2 id="upgrade-offer-title">{PLANNED_UNLIMITED_PLAN.name}</h2>
                  </div>
                  <div class="upgrade-price">
                    <span>{PLANNED_UNLIMITED_PLAN.price}</span>
                    <small>planned price</small>
                  </div>
                </div>
                <ul class="upgrade-features">
                  {PLANNED_UNLIMITED_PLAN.features.map((feature) => <li>{feature}</li>)}
                  <li>Keep existing projects, members, and agent connections</li>
                </ul>
                <div class="upgrade-unavailable" role="status">
                  <strong>Billing isn’t connected yet.</strong>
                  <p>The $19 plan is a preview. Checkout and paid activation are not available in dongo today, so your current plan and allowance will not change on this page.</p>
                </div>
              </section>

              <aside class="upgrade-current" aria-labelledby="upgrade-current-title">
                <div class="upgrade-offer__kicker">Current organization</div>
                <h2 id="upgrade-current-title">{admin().organization.name}</h2>
                <dl class="upgrade-facts">
                  <div><dt>Plan</dt><dd>{admin().organization.plan === "free" ? "Free" : "Paid"}</dd></div>
                  <div><dt>Active projects</dt><dd>{admin().activeProjectCount} / {admin().projectAllowance.limit ?? "∞"}</dd></div>
                  <div><dt>Plan owner</dt><dd>{admin().membershipRole === "owner" ? "You" : "Organization owner"}</dd></div>
                </dl>
                <Show when={admin().organization.plan === "paid"}>
                  <p class="note">This organization already has unlimited active projects.</p>
                </Show>
                <Show when={admin().organization.plan === "free" && admin().projectAllowance.source === "operator_override"}>
                  <p class="note">This remains a Free organization with additional project capacity granted by an operator.</p>
                </Show>
                <Show when={admin().membershipRole === "member"}>
                  <p class="security-note">Only an organization owner can manage a future paid plan.</p>
                </Show>
                <div class="upgrade-actions">
                  <Show when={admin().membershipRole === "owner" && creationAction()?.intent === "create"}>
                    <A class="button button--primary" href={creationAction()!.href}>Create another project</A>
                  </Show>
                  <A class="button button--quiet" href={`/app/${props.orgSlug}/${props.projectSlug}`}>Use current project</A>
                  <Show when={admin().membershipRole === "owner" && creationAction()?.intent === "upgrade"}>
                    <A class="text-link" href={`/app/${props.orgSlug}/${props.projectSlug}/settings?tab=General`}>Archive an active project instead</A>
                  </Show>
                </div>
              </aside>
            </div>

            <p class="upgrade-footnote">No payment details are collected here. Future billing will require an owner-authenticated checkout and verified server-side activation before any allowance changes.</p>
          </>
        )}</Show>
      </div>
    </main>
  );
}
