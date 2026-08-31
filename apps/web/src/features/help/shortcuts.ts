export type DongoShortcut = {
  keys: readonly string[];
  label: string;
  description: string;
};

export const DONGO_SHORTCUTS: readonly DongoShortcut[] = [
  { keys: ["C"], label: "Capture", description: "Focus the Intake composer." },
  { keys: ["/"], label: "Search", description: "Search work, comments, and Intake." },
  { keys: ["J", "↓"], label: "Next", description: "Select the next item on Overview." },
  { keys: ["K", "↑"], label: "Previous", description: "Select the previous item on Overview." },
  { keys: ["Enter"], label: "Open", description: "Open the selected item and keep it in the URL." },
  { keys: ["Space"], label: "Peek", description: "Preview the selected item without changing the URL." },
  { keys: ["Esc"], label: "Close", description: "Close the current menu, preview, or panel." },
  { keys: ["R"], label: "Respond / review", description: "Open the selected item at the response or review area." },
  { keys: ["W"], label: "Move to Working", description: "Ask the connected agent to start selected Ready work." },
  { keys: ["D"], label: "Mark Done", description: "Finish selected work through its active agent run." },
  { keys: ["E"], label: "Edit", description: "Edit selected work when human editing is available." },
  { keys: ["⌘", "Enter"], label: "Submit", description: "Submit the composer currently being edited." },
  { keys: ["⌘", "K"], label: "Command menu", description: "Open the command menu from anywhere in the project." },
  { keys: ["?"], label: "Show shortcuts", description: "Open the keyboard shortcut reference." },
];

