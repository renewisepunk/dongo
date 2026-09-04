import { For, Show } from "solid-js";

import { lowercaseDongoBrand } from "../../lib/brand-case";
import {
  activitySignalState,
  formatRunElapsed,
  hostFallbackLabel,
  leaseHealthLabel,
  workspaceLabel,
} from "../../lib/parallel-execution";
import type { ProjectConcurrencySnapshot } from "../../lib/project-data";
import { AgentIdentity } from "../../components/AgentIdentity";

export type ConcurrentActivityProps = {
  snapshot?: ProjectConcurrencySnapshot;
  status: "loading" | "ready" | "error";
  selectedWorkId?: string;
  workHref: (identifier: string) => string;
  onSelect: (
    event: MouseEvent & { currentTarget: HTMLAnchorElement },
    identifier: string,
  ) => void;
};

export function ConcurrentActivity(props: ConcurrentActivityProps) {
  const runs = () => props.snapshot?.runs ?? [];
  const capacity = () => props.snapshot?.capacity;
  const policy = () => props.snapshot?.policy;
  const capacityLabel = () => {
    if (props.status === "error" || !props.snapshot) return "Status unavailable";
    if (!policy()?.enabled) return "Single-agent";
    return `${capacity()?.activeRuns ?? 0} / ${capacity()?.maxConcurrentRuns ?? policy()!.maxConcurrentRuns} active`;
  };
  const signalState = () => activitySignalState(props.status, runs().length);

  return (
    <Show when={props.status !== "loading"}>
      <section class="concurrent-activity" aria-labelledby="concurrent-activity-heading">
        <div class="concurrent-activity__head">
          <div>
            <div class="section-heading" id="concurrent-activity-heading">
              <span
                class="concurrent-activity__signal"
                data-state={signalState()}
                aria-hidden="true"
              />
              <span>agent activity</span>
              <span class="section-heading__count">{runs().length}</span>
            </div>
            <p>Live claimed work across connected agent sessions.</p>
          </div>
          <span class="concurrent-activity__capacity" aria-live="polite">{capacityLabel()}</span>
        </div>

        <Show
          when={props.status === "ready"}
          fallback={<div class="concurrent-activity__empty" role="status">Live agent activity is temporarily unavailable. Working items remain below.</div>}
        >
          <Show
            when={runs().length > 0}
            fallback={<div class="concurrent-activity__empty">No active agent runs.</div>}
          >
            <div class="concurrent-activity__grid">
              <For each={runs()}>{(run) => {
                const fallback = () => hostFallbackLabel(run);
                return (
                  <a
                    class="agent-run-card"
                    data-state={run.state}
                    data-run-id={run.id}
                    href={props.workHref(run.workItem.identifier)}
                    aria-current={props.selectedWorkId === run.workItem.id ? "page" : undefined}
                    onClick={(event) => props.onSelect(event, run.workItem.identifier)}
                  >
                    <span class="agent-run-card__rail" aria-hidden="true" />
                    <span class="agent-run-card__topline">
                      <span class="agent-run-card__identity">
                        <AgentIdentity
                          agentName={run.actor.displayName?.trim() || run.actor.name.trim()}
                          agentType={run.actor.agentType}
                          label={lowercaseDongoBrand(run.actor.displayName?.trim() || run.actor.name.trim() || "Agent")}
                          labelClass="agent-run-card__agent"
                        />
                      </span>
                      <span class="agent-run-card__state"><span aria-hidden="true" />{run.state === "running" ? "Running" : "Waiting"}</span>
                    </span>
                    <span class="agent-run-card__work">
                      <span class="mono">{run.workItem.identifier}</span>
                      <strong>{run.workItem.title}</strong>
                    </span>
                    <span class="agent-run-card__progress">{run.latestProgress || "No progress update yet."}</span>
                    <span class="agent-run-card__telemetry">
                      <span>{formatRunElapsed(run.elapsedMilliseconds)}</span>
                      <span>·</span>
                      <span data-lease={run.lease.status}>{leaseHealthLabel(run.lease.status)}</span>
                    </span>
                    <span class="agent-run-card__workspace">{workspaceLabel(run)}</span>
                    <Show when={fallback()}>{(message) => (
                      <span class="agent-run-card__fallback">{message()}</span>
                    )}</Show>
                  </a>
                );
              }}</For>
            </div>
          </Show>
        </Show>
      </section>
    </Show>
  );
}
