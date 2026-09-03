import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
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

export function IssueActionsMenu(props: {
  allowCompleted: boolean;
  active?: boolean;
  onConfirm: (input: { reason: ClosureReason; note?: string }) => Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [formOpen, setFormOpen] = createSignal(false);
  const [reason, setReason] = createSignal<ClosureReason>(
    props.allowCompleted ? "completed" : "no_longer_relevant",
  );
  const [note, setNote] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const formHeadingId = createUniqueId();
  const formDescriptionId = createUniqueId();
  const reasonGroupName = createUniqueId();
  let root: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;
  let form: HTMLFormElement | undefined;
  const options = () => props.allowCompleted
    ? [{ value: "completed" as const, label: "Completed" }, ...cancellationReasons]
    : cancellationReasons;

  createEffect(() => {
    if (!props.allowCompleted && reason() === "completed") {
      setReason("no_longer_relevant");
    }
  });

  const restoreTriggerFocus = () => queueMicrotask(() => trigger?.focus());

  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) restoreTriggerFocus();
  };

  const openMenu = () => {
    setMenuOpen(true);
    queueMicrotask(() => menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  };

  const openForm = () => {
    setMenuOpen(false);
    setFormOpen(true);
    setError("");
    queueMicrotask(() => form?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus());
  };

  const closeForm = () => {
    if (pending()) return;
    setFormOpen(false);
    setError("");
    restoreTriggerFocus();
  };

  onMount(() => {
    const dismissMenu = (event: PointerEvent) => {
      if (menuOpen() && event.target instanceof Node && !root?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismissMenu);
    onCleanup(() => document.removeEventListener("pointerdown", dismissMenu));
  });

  const confirm = async () => {
    if (pending()) return;
    setPending(true);
    setError("");
    try {
      await props.onConfirm({ reason: reason(), note: note().trim() || undefined });
      setFormOpen(false);
    } catch {
      setError("This issue changed before it could be closed. Review the latest state and try again.");
    } finally {
      setPending(false);
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent) => {
    const menuElement = event.currentTarget as HTMLElement;
    const items = [...menuElement.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    if (event.key === "ArrowUp") next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (next !== undefined && items[next]) {
      event.preventDefault();
      items[next].focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === "Tab") {
      window.setTimeout(() => closeMenu(), 0);
    }
  };

  return (
    <div ref={root} class="issue-actions">
      <button
        ref={trigger}
        class="issue-actions__trigger"
        type="button"
        aria-label="Issue actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen()}
        onClick={() => menuOpen() ? closeMenu() : openMenu()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <circle cx="4" cy="10" r="1.25" />
          <circle cx="10" cy="10" r="1.25" />
          <circle cx="16" cy="10" r="1.25" />
        </svg>
      </button>

      <Show when={menuOpen()}>
        <div
          ref={menu}
          class="menu-popover issue-actions__menu"
          role="menu"
          aria-label="Issue actions"
          onKeyDown={handleMenuKeyDown}
        >
          <button
            class="menu-action menu-action--danger"
            type="button"
            role="menuitem"
            onClick={openForm}
          >
            Close issue
          </button>
        </div>
      </Show>

      <Show when={formOpen()}>
        <form
          ref={form}
          class="detail-card issue-close__form"
          role="form"
          aria-labelledby={formHeadingId}
          aria-describedby={formDescriptionId}
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !pending()) {
              event.preventDefault();
              event.stopPropagation();
              closeForm();
            }
          }}
        >
          <strong id={formHeadingId}>Close this issue</strong>
          <p class="note" id={formDescriptionId}>
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
                  name={reasonGroupName}
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
            <button class="button button--danger" type="submit" disabled={pending()}>
              {pending() ? "Closing…" : reason() === "completed" ? "Mark done" : "Close issue"}
            </button>
            <button class="button button--quiet" type="button" disabled={pending()} onClick={closeForm}>Keep open</button>
          </div>
        </form>
      </Show>
    </div>
  );
}
