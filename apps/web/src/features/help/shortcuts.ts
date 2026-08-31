export type DongoShortcut = {
  id:
    | "capture"
    | "search"
    | "next"
    | "previous"
    | "sidebar"
    | "open"
    | "peek"
    | "close"
    | "respond"
    | "working"
    | "done"
    | "edit"
    | "submit"
    | "commands"
    | "shortcuts";
  keys: readonly string[];
  label: string;
  description: string;
};

export const DONGO_SHORTCUTS: readonly DongoShortcut[] = [
  { id: "capture", keys: ["C"], label: "Capture", description: "Focus the Intake composer." },
  { id: "search", keys: ["/"], label: "Search", description: "Search work, comments, and Intake." },
  { id: "next", keys: ["J", "↓"], label: "Next", description: "Select the next item; from an empty capture box, return to the list." },
  { id: "previous", keys: ["K", "↑"], label: "Previous", description: "Select the previous item; above the first item, focus the capture box." },
  { id: "sidebar", keys: ["←"], label: "Issue / detail", description: "In the wide layout, toggle focus between the open issue detail and its sidebar row." },
  { id: "open", keys: ["Enter"], label: "Open", description: "Open the selected item and keep it in the URL." },
  { id: "peek", keys: ["Space"], label: "Peek", description: "Preview the selected item without changing the URL." },
  { id: "close", keys: ["Esc"], label: "Close", description: "Close the current menu, preview, or panel." },
  { id: "respond", keys: ["R"], label: "Respond / review", description: "Open the selected item at the response or review area." },
  { id: "working", keys: ["W"], label: "Move to Working", description: "Show the agent-owned start boundary for selected Ready work." },
  { id: "done", keys: ["D"], label: "Mark Done", description: "Show the active-run completion boundary for selected work." },
  { id: "edit", keys: ["E"], label: "Edit", description: "Open the selected work at a human correction comment." },
  { id: "submit", keys: ["⌘", "Enter"], label: "Submit", description: "Submit the composer currently being edited." },
  { id: "commands", keys: ["⌘", "K"], label: "Command menu", description: "Open the command menu from anywhere in the project." },
  { id: "shortcuts", keys: ["?"], label: "Show shortcuts", description: "Open the keyboard shortcut reference." },
];
