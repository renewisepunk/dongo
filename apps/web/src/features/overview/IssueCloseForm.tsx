import { createSignal, For, Show } from "solid-js";
import type { ClosureReason } from "./model";

const cancellationReasons: Array<{ value: ClosureReason; label: string }> = [
  { value: "no_longer_relevant", label: "No longer relevant" },
  { value: "incorrect", label: "Incorrect or added by mistake" },
  { value: "other", label: "Other reason" },
];

export function closureReasonLabel(reason: ClosureReason | undefined) {
  if (reason === "completed") return "Completed";
  return cancellationReasons.find((option) => option.value === reason)?.label;
}

export function IssueCloseForm(props: {
  allowCompleted: boolean;
  active?: boolean;
  onConfirm: (input: { reason: ClosureReason; note?: string }) => Promise<void>;
}) {
  const [open, setOpen] = createSignal(false);
  const [reason, setReason] = createSignal<ClosureReason>(
    props.allowCompleted ? "completed" : "no_longer_relevant",
  );
  const [note, setNote] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const options = () => props.allowCompleted
    ? [{ value: "completed" as const, label: "Completed" }, ...cancellationReasons]
    : cancellationReasons;

  const confirm = async () => {
    if (pending()) return;
    setPending(true);
    setError("");
    try {
      await props.onConfirm({ reason: reason(), note: note().trim() || undefined });
      setOpen(false);
    } catch {
      setError("This issue changed before it could be closed. Review the latest state and try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section class="detail-section issue-close" aria-labelledby="issue-actions-heading">
      <div class="detail-section__label" id="issue-actions-heading">issue actions</div>
      <Show when={open()} fallback={
        <button class="button button--quiet button--danger" type="button" aria-label="Set issue outcome" onClick={() => setOpen(true)}>Close issue</button>
      }>
        <div class="detail-card issue-close__form">
          <strong>Close this issue</strong>
          <p class="note">
            {props.active
              ? "Closing this issue cancels its active agent run. The issue and its history stay available."
              : "The issue and its history stay available; nothing is deleted."}
          </p>
          <fieldset class="issue-close__reasons">
            <legend>Outcome</legend>
            <For each={options()}>{(option) => (
              <label class="issue-close__reason">
                <input
                  type="radio"
                  name="close-reason"
                  value={option.value}
                  checked={reason() === option.value}
                  onChange={() => setReason(option.value)}
                />
                <span>{option.label}</span>
              </label>
            )}</For>
          </fieldset>
          <label class="issue-close__note">
            <span>Note <span class="note">optional</span></span>
            <textarea class="textarea" maxlength={2000} rows={3} value={note()} onInput={(event) => setNote(event.currentTarget.value)} />
          </label>
          <Show when={error()}><div class="security-note" role="alert">{error()}</div></Show>
          <div class="response-actions">
            <button class="button button--danger" type="button" disabled={pending()} onClick={() => void confirm()}>
              {pending() ? "Closing…" : reason() === "completed" ? "Mark done" : "Close issue"}
            </button>
            <button class="button button--quiet" type="button" disabled={pending()} onClick={() => { setOpen(false); setError(""); }}>Keep open</button>
          </div>
        </div>
      </Show>
    </section>
  );
}
