import { useNavigate } from "@solidjs/router";
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Brand } from "../../components/Brand";
import { SignOutButton } from "../../components/SignOutButton";
import {
  connectPlatformAdmin,
  type PlatformAdminConnection,
  type PlatformDashboard,
  type PlatformOrganizationUsage,
} from "../../lib/platform-data";
import "./platform-admin.css";

export type PlatformAdminProps = {
  connect?: () => Promise<PlatformAdminConnection>;
};

function dateTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function boundedCount(value: number, truncated: boolean): string {
  return `${value.toLocaleString()}${truncated ? "+" : ""}`;
}

function AllowanceEditor(props: {
  organization: PlatformOrganizationUsage;
  onSave: (input: {
    activeProjectLimit: number | null;
    totalWorkItemLimit: number | null;
    reason: string;
  }) => Promise<void>;
}) {
  const initialProjectLimit = () => props.organization.projects.source === "operator_override"
    ? String(props.organization.projects.limit ?? "")
    : "";
  const initialWorkLimit = () => props.organization.workItems.source === "operator_override"
    ? String(props.organization.workItems.limit ?? "")
    : "";
  const [projectLimit, setProjectLimit] = createSignal(initialProjectLimit());
  const [workLimit, setWorkLimit] = createSignal(initialWorkLimit());
  const [reason, setReason] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");

  const numericLimit = (value: string): number | null => {
    const trimmed = value.trim();
    return trimmed ? Number(trimmed) : null;
  };

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (pending()) return;
    setPending(true);
    setError("");
    try {
      await props.onSave({
        activeProjectLimit: numericLimit(projectLimit()),
        totalWorkItemLimit: numericLimit(workLimit()),
        reason: reason(),
      });
      setReason("");
    } catch {
      setError("Limits could not be saved. Reload current usage and try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form class="platform-admin__allowance-form" onSubmit={submit}>
      <label>
        <span>Active projects</span>
        <input
          type="number"
          min="1"
          max="100"
          inputmode="numeric"
          value={projectLimit()}
          disabled={props.organization.plan === "paid" || pending()}
          placeholder={props.organization.plan === "paid" ? "Unlimited" : "Plan default (1)"}
          onInput={(event) => setProjectLimit(event.currentTarget.value)}
        />
      </label>
      <label>
        <span>Total Work items</span>
        <input
          type="number"
          min="1"
          max="1000"
          inputmode="numeric"
          value={workLimit()}
          disabled={pending()}
          placeholder={props.organization.plan === "free" ? "Plan default (250)" : "Unlimited"}
          onInput={(event) => setWorkLimit(event.currentTarget.value)}
        />
      </label>
      <label class="platform-admin__reason">
        <span>Audit reason</span>
        <input
          required
          maxlength="500"
          value={reason()}
          disabled={pending()}
          placeholder="Why is this allowance changing?"
          onInput={(event) => setReason(event.currentTarget.value)}
        />
      </label>
      <button class="button button--primary" type="submit" disabled={pending()}>
        {pending() ? "Saving…" : "Save limits"}
      </button>
      <Show when={error()}><p class="form-error" role="alert">{error()}</p></Show>
    </form>
  );
}

export function PlatformAdmin(props: PlatformAdminProps) {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = createSignal<PlatformDashboard>();
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal("");
  const [loadingMore, setLoadingMore] = createSignal<"accounts" | "organizations">();
  const [status, setStatus] = createSignal("");
  const [tab, setTab] = createSignal<"usage" | "limits">("usage");
  const [query, setQuery] = createSignal("");
  let connection: PlatformAdminConnection | undefined;

  const organizations = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const rows = dashboard()?.organizations ?? [];
    return needle
      ? rows.filter((row) => `${row.name} ${row.slug}`.toLowerCase().includes(needle))
      : rows;
  });

  const accounts = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const rows = dashboard()?.accounts ?? [];
    return needle
      ? rows.filter((row) => `${row.name} ${row.email ?? ""}`.toLowerCase().includes(needle))
      : rows;
  });

  const reload = async () => {
    if (!connection) return;
    setLoading(true);
    setLoadError("");
    try {
      setDashboard(await connection.loadDashboard());
    } catch {
      setLoadError("Platform administration is unavailable for this account.");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    let disposed = false;
    void (async () => {
      try {
        const connected = await (props.connect?.() ?? connectPlatformAdmin());
        if (disposed) {
          await connected.close();
          return;
        }
        connection = connected;
        await reload();
      } catch {
        setLoadError("Platform administration is unavailable for this account.");
        setLoading(false);
      }
    })();
    onCleanup(() => {
      disposed = true;
      void connection?.close();
    });
  });

  const saveAllowances = async (
    organization: PlatformOrganizationUsage,
    input: { activeProjectLimit: number | null; totalWorkItemLimit: number | null; reason: string },
  ) => {
    if (!connection) throw new Error("unavailable");
    const updated = await connection.updateOrganizationAllowances({
      organizationId: organization.organizationId,
      expectedProjectCapacityRevision: organization.projectCapacityRevision,
      expectedWorkCapacityRevision: organization.workCapacityRevision,
      ...input,
    });
    setDashboard((current) => current ? {
      ...current,
      organizations: current.organizations.map((row) =>
        row.organizationId === updated.organizationId ? updated : row,
      ),
    } : current);
    setStatus(updated.changed ? `Saved limits for ${updated.name}.` : `Limits for ${updated.name} were already current.`);
  };

  const loadMoreAccounts = async () => {
    const cursor = dashboard()?.accountCursor;
    if (!connection || !cursor || loadingMore()) return;
    setLoadingMore("accounts");
    try {
      const page = await connection.loadAccounts(cursor);
      setDashboard((current) => current ? {
        ...current,
        accounts: [...current.accounts, ...page.rows.filter((row) =>
          !current.accounts.some((existing) => existing.profileId === row.profileId))],
        accountCursor: page.cursor,
        accountsTruncated: page.cursor !== undefined,
      } : current);
      setStatus(`Loaded ${page.rows.length} more accounts.`);
    } catch {
      setStatus("More accounts could not be loaded. Try again.");
    } finally {
      setLoadingMore(undefined);
    }
  };

  const loadMoreOrganizations = async () => {
    const cursor = dashboard()?.organizationCursor;
    if (!connection || !cursor || loadingMore()) return;
    setLoadingMore("organizations");
    try {
      const page = await connection.loadOrganizations(cursor);
      setDashboard((current) => current ? {
        ...current,
        organizations: [...current.organizations, ...page.rows.filter((row) =>
          !current.organizations.some((existing) =>
            existing.organizationId === row.organizationId))],
        organizationCursor: page.cursor,
        organizationsTruncated: page.cursor !== undefined,
      } : current);
      setStatus(`Loaded ${page.rows.length} more organizations.`);
    } catch {
      setStatus("More organizations could not be loaded. Try again.");
    } finally {
      setLoadingMore(undefined);
    }
  };

  return (
    <main class="platform-admin">
      <header class="platform-admin__header">
        <button class="platform-admin__brand" type="button" onClick={() => navigate("/")} aria-label="Return to dongo">
          <Brand compact />
        </button>
        <div>
          <span class="eyebrow eyebrow--amber">super admin</span>
          <h1>platform administration</h1>
        </div>
        <SignOutButton class="button button--quiet" />
      </header>

      <div class="platform-admin__body">
        <p class="platform-admin__lede">Private operational usage and allowance controls. Raw Work content, comments, attachments, and payment data are not shown.</p>
        <div class="platform-admin__tabs" role="tablist" aria-label="Administration pages">
          <button type="button" role="tab" aria-selected={tab() === "usage"} onClick={() => setTab("usage")}>Accounts & usage</button>
          <button type="button" role="tab" aria-selected={tab() === "limits"} onClick={() => setTab("limits")}>Organization limits</button>
        </div>
        <label class="platform-admin__search">
          <span class="visually-hidden">Filter administration rows</span>
          <input type="search" placeholder="Filter by name, email, or slug" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
        </label>
        <p class="visually-hidden" aria-live="polite">{status()}</p>

        <Show when={loading()}><p role="status">Loading privacy-safe usage…</p></Show>
        <Show when={loadError()}>
          <section class="platform-admin__error" role="alert">
            <h2>Administration unavailable</h2>
            <p>{loadError()}</p>
            <button class="button" type="button" onClick={() => window.location.reload()}>Retry</button>
          </section>
        </Show>

        <Show when={!loading() && !loadError() && dashboard()}>{(data) => (
          <>
            <Show when={tab() === "usage"}>
              <section aria-labelledby="account-usage-heading">
                <div class="platform-admin__section-heading">
                  <div><span class="eyebrow">usage</span><h2 id="account-usage-heading">Accounts</h2></div>
                  <span>{data().accounts.length}{data().accountsTruncated ? "+" : ""} accounts</span>
                </div>
                <div class="platform-admin__table-wrap">
                  <table>
                    <thead><tr><th scope="col">Account</th><th scope="col">Signed up</th><th scope="col">Last active</th><th scope="col">Created</th><th scope="col">Closed</th></tr></thead>
                    <tbody>
                      <For each={accounts()}>{(account) => (
                        <tr>
                          <th scope="row"><strong>{account.name}</strong><span>{account.email ?? "Email unavailable"}</span></th>
                          <td>{dateTime(account.signedUpAt)}</td>
                          <td>{dateTime(account.lastActiveAt)}</td>
                          <td>{account.usage.workItemsCreated.toLocaleString()}</td>
                          <td>{account.usage.workItemsClosed.toLocaleString()}</td>
                        </tr>
                      )}</For>
                    </tbody>
                  </table>
                </div>
                <Show when={data().accountCursor}>
                  <button class="button button--quiet" type="button" disabled={Boolean(loadingMore())} onClick={() => void loadMoreAccounts()}>
                    {loadingMore() === "accounts" ? "Loading…" : "Load more accounts"}
                  </button>
                </Show>
                <p class="security-note">{data().privacy}</p>
                <p class="security-note">Created and closed counts are attributed to the signed-in person who performed or authorized the work and begin when usage tracking is enabled.</p>
              </section>
            </Show>

            <Show when={tab() === "limits"}>
              <section aria-labelledby="organization-limits-heading">
                <div class="platform-admin__section-heading">
                  <div><span class="eyebrow">allowances</span><h2 id="organization-limits-heading">Organizations</h2></div>
                  <span>{data().organizations.length}{data().organizationsTruncated ? "+" : ""} organizations</span>
                </div>
                <div class="platform-admin__organizations">
                  <For each={organizations()}>{(organization) => (
                    <article class="platform-admin__organization">
                      <header>
                        <div><h3>{organization.name}</h3><span class="mono">{organization.slug}</span></div>
                        <span class="platform-admin__plan">{organization.plan === "free" ? "Free" : "Paid"}</span>
                      </header>
                      <dl>
                        <div><dt>Members</dt><dd>{boundedCount(organization.members.count, organization.members.truncated)}</dd></div>
                        <div><dt>Active projects</dt><dd>{boundedCount(organization.projects.active, organization.projects.activeTruncated)} / {organization.projects.limit ?? "∞"}</dd></div>
                        <div><dt>Total Work</dt><dd>{organization.workItems.total === undefined ? "Counting…" : `${organization.workItems.total.toLocaleString()}${organization.workItems.totalIsExact ? "" : "+"}`} / {organization.workItems.limit ?? "∞"}</dd></div>
                        <div><dt>Closed Work</dt><dd>{boundedCount(organization.workItems.closed, false)}</dd></div>
                        <div><dt>Billing</dt><dd>Not configured</dd></div>
                      </dl>
                      <Show when={organization.workItems.trackedFrom}>
                        <p class="security-note">Closed Work tracking started {dateTime(organization.workItems.trackedFrom!)}.</p>
                      </Show>
                      <p class="security-note">Lower limits never delete projects or Work. New creation stays blocked until the organization is within its effective allowance.</p>
                      <AllowanceEditor organization={organization} onSave={(input) => saveAllowances(organization, input)} />
                    </article>
                  )}</For>
                </div>
                <Show when={data().organizationCursor}>
                  <button class="button button--quiet" type="button" disabled={Boolean(loadingMore())} onClick={() => void loadMoreOrganizations()}>
                    {loadingMore() === "organizations" ? "Loading…" : "Load more organizations"}
                  </button>
                </Show>
              </section>
            </Show>
          </>
        )}</Show>
      </div>
    </main>
  );
}
