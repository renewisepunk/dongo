import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { DONGO_SHORTCUTS, type DongoShortcut } from "./shortcuts";

export type OverviewCommandId = DongoShortcut["id"] | "help";

export type OverviewCommand = {
  id: OverviewCommandId;
  label: string;
  description: string;
  keys: readonly string[];
  status?: string;
};

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getAttribute("aria-hidden") !== "true");
}

function trapFocus(event: KeyboardEvent, container: HTMLElement) {
  if (event.key !== "Tab") return;
  const focusable = focusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function ShortcutKeys(props: { keys: readonly string[] }) {
  return (
    <>
      <span class="keyboard-overlay__keys" aria-hidden="true">
        <For each={props.keys}>{(key, index) => (
          <><kbd>{key}</kbd>{index() < props.keys.length - 1 ? <span>or</span> : null}</>
        )}</For>
      </span>
      <Show when={props.keys.length}>
        <span class="visually-hidden">Shortcut: {props.keys.join(" or ")}</span>
      </Show>
    </>
  );
}

export function CommandMenu(props: {
  commands: readonly OverviewCommand[];
  onRun: (id: OverviewCommandId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal("");
  let dialog: HTMLDivElement | undefined;
  let input: HTMLInputElement | undefined;

  const results = createMemo(() => {
    const term = query().trim().toLowerCase();
    if (!term) return props.commands;
    return props.commands.filter((command) =>
      `${command.label} ${command.description} ${command.status ?? ""}`.toLowerCase().includes(term),
    );
  });

  const moveCommandFocus = (direction: -1 | 1) => {
    const buttons = [...(dialog?.querySelectorAll<HTMLButtonElement>("[data-command]") ?? [])];
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = current < 0
      ? direction === 1 ? 0 : buttons.length - 1
      : (current + direction + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  onMount(() => input?.focus());

  return (
    <div
      class="keyboard-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        ref={dialog}
        class="command-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-menu-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            moveCommandFocus(event.key === "ArrowDown" ? 1 : -1);
            return;
          }
          if (event.key === "Enter" && event.target === input) {
            const first = dialog?.querySelector<HTMLButtonElement>("[data-command]");
            if (first) {
              event.preventDefault();
              first.click();
            }
            return;
          }
          trapFocus(event, event.currentTarget);
        }}
      >
        <div class="command-menu__head">
          <span class="command-menu__prompt" aria-hidden="true">›</span>
          <input
            ref={input}
            class="command-menu__input"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Type a command…"
            aria-label="Filter commands"
          />
          <button class="keyboard-overlay__close" type="button" onClick={props.onClose}>esc</button>
        </div>
        <h2 class="visually-hidden" id="command-menu-title">Command menu</h2>
        <div class="command-menu__results" aria-live="polite">
          <For each={results()}>{(command) => (
            <button
              class="command-menu__item"
              type="button"
              data-command={command.id}
              onClick={() => props.onRun(command.id)}
            >
              <span class="command-menu__copy">
                <span class="command-menu__label">{command.label}</span>
                <span class="command-menu__description">{command.description}</span>
              </span>
              <Show when={command.status}><span class="command-menu__status">{command.status}</span></Show>
              <ShortcutKeys keys={command.keys} />
            </button>
          )}</For>
          <Show when={results().length === 0}>
            <div class="command-menu__empty">No matching command.</div>
          </Show>
        </div>
        <div class="command-menu__foot"><span>↑↓ navigate</span><span>↵ run</span><span>esc close</span></div>
      </div>
    </div>
  );
}

export function ShortcutDialog(props: { onClose: () => void }) {
  let dialog: HTMLDivElement | undefined;
  let closeButton: HTMLButtonElement | undefined;

  onMount(() => closeButton?.focus());

  return (
    <div
      class="keyboard-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        ref={dialog}
        class="shortcut-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-dialog-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
            return;
          }
          trapFocus(event, event.currentTarget);
        }}
      >
        <div class="shortcut-dialog__head">
          <div>
            <div class="eyebrow eyebrow--amber">Keyboard</div>
            <h2 id="shortcut-dialog-title">Move at agent speed</h2>
          </div>
          <button ref={closeButton} class="keyboard-overlay__close" type="button" onClick={props.onClose}>esc</button>
        </div>
        <div class="shortcut-dialog__list">
          <For each={DONGO_SHORTCUTS}>{(shortcut) => (
            <div class="shortcut-dialog__row">
              <ShortcutKeys keys={shortcut.keys} />
              <span class="shortcut-dialog__label">{shortcut.label}</span>
            </div>
          )}</For>
        </div>
        <div class="shortcut-dialog__note">Single-key shortcuts pause while you type. Use ⌘ on macOS or Ctrl on Windows and Linux.</div>
      </div>
    </div>
  );
}
