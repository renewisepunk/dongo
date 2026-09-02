# Design implementation contract

Status: accepted implementation input. This document does not replace or modify the PRD.

## Source of truth

The user-authored handoff at [`user-journey-desktop-and-mobile/README.md`](user-journey-desktop-and-mobile/README.md) is mandatory for web implementation. Its primary design source is:

- [`project/dongo Journey.dc.html`](user-journey-desktop-and-mobile/project/dongo%20Journey.dc.html)
- the imported design runtime, [`project/support.js`](user-journey-desktop-and-mobile/project/support.js), is prototype infrastructure and is not shipped in the product;
- [`project/uploads/04-user-journey.md`](user-journey-desktop-and-mobile/project/uploads/04-user-journey.md) supplies the complete screen/state inventory beyond the interactive prototype.

The HTML is a behavioral and visual reference, not an application dependency. Rebuild it in the selected SolidStart stack with semantic components, real routes, real state, and accessible controls. Do not embed the prototype runtime or translate its inline styles mechanically.

## Visual contract

- Switzer is the primary UI typeface; the system fallback remains usable while it loads. Operational labels, identifiers, timestamps, shortcuts, and code use `ui-monospace, Menlo, monospace`.
- Core canvas is `#08080a`; elevated surfaces use `#0a0a0d` through `#15151a`; primary text is `#ececee`; subdued text follows the prototype's `#b9b9c1`, `#93939c`, `#7d7d87`, `#6c6c76`, `#5a5a63`, and `#4e4e57` hierarchy.
- Amber is `oklch(0.84 0.19 78)` and communicates dongo identity, focus, current activity, and human Attention. Green is `oklch(0.82 0.20 150)` and communicates successful connection/completion.
- Geometry is square and compact: one-pixel borders, no decorative rounding, restrained shadows, dense 12–18 px type, and no ornamental gradients.
- Motion is limited to the blinking terminal cursor/activity dot, small spinners, and short 180–280 ms entry transitions. Respect reduced-motion preferences.
- Focus is always visible. Icon-only controls require accessible names. Minimum interactive height is 36 px for compact controls and 44–48 px for primary/mobile actions.
- “Needs You” is the strongest content block. No dashboard charts, project-management sidebar, board, sprint, or status-management chrome is added.

## Responsive contract

- The desktop reference canvas is 1180 × 760, with content centered at a 780 px maximum and a 470 px route-backed detail panel over Overview.
- At mobile width, the product fills the viewport; detail and search become full-screen sheets. The prototype's 402 × 812 frame is a test viewport, not a fixed product size.
- The prototype-only desktop/mobile toggle, restart button, frame border, outer caption, and fixed canvas dimensions are not product UI.
- Route state, browser Back, restored Overview scroll/focus, safe-area insets, high zoom, and real viewport resizing replace the prototype's in-memory mode switch.

## Screen contract

Implement the prototype's hierarchy and states for:

- sign in, email code, callback, and first-project onboarding;
- agent connection/authorization;
- empty and populated Overview;
- Add Something composer and attachment states;
- dedicated human Ideas route with Capture/Edit, Open manual ordering,
  Archived/Promoted filters, Archive/Restore, and deliberate one-to-one
  promotion to Intake; Ideas never appear in agent-facing Overview or search;
- composer image paste plus the full-viewport desktop file drop zone;
- Needs You, Working, Ready, Inbox, and Recently Done;
- Inbox and Ready/Working/Needs You/Done detail; unprocessed Inbox detail adds
  explicit Edit/Save states for text, context, links, and additive attachments,
  preserves drafts through live revision conflicts, and becomes read-only after
  processing or dismissal;
- live parallel-Run visualization sourced from authoritative subscriptions,
  with one card per active Run showing agent, canonical Work, Running/Waiting,
  latest progress, elapsed/lease health, and a bounded workspace label;
- project settings with **Single-agent** as the default and owner-only **Allow
  parallel work** plus a 2–8 concurrent-Run safety cap (default 4), clearly
  separated from plan limits and host worktree creation;
- human Attention response and comments, including pasted/dropped comment attachments with upload progress, failure recovery, and conversation-entry attachment rows;
- search overlay/sheet, command menu, shortcut reference dialog, route-backed Help guide, and toast/status feedback.

The full journey document adds route-backed Completed, settings, installation access/revocation, members, plan/storage, archived/unavailable, offline/reconnecting/session-expired, conflict, and later native screens. Where the prototype omits one of those surfaces, extend its same typography, palette, spacing, borders, hierarchy, and interaction rules rather than introducing another visual system.

For workspace labels, render `Worktree · <branch>` when a safe branch label is
supplied, otherwise `Worktree · <worktree name>` when its safe label is
supplied, `Isolated workspace` when isolation support is known but display
details are omitted, and `Workspace details unavailable` otherwise. Never
render an absolute local path. Unsupported or undisclosed hosts remain serially
usable, and shared checkout explicitly keeps additional work serial; the
interface must not imply that dongo itself creates agents or worktrees.

The live region heading is `agent activity` with “Live claimed work across
connected agent sessions.” A missing progress summary reads `No progress update
yet.` Lease states are `Lease healthy`, `renewing`, `released`, and `expired`.
A query failure says activity is temporarily unavailable without disabling
canonical Working navigation.

When an active Run card already represents a Working item, do not repeat that
item in the Working section. Keep the ordinary Working row for items without a
matching active Run and whenever live agent activity is unavailable. If a
focused Working row is replaced by its matching Run card, move focus to that
card so live reconciliation does not strand keyboard users.

Ideas use `/app/:orgSlug/:projectSlug/ideas` with query-backed `?idea={ideaId}`
detail. Keep the Ideas header link visible, state plainly “Possible future work.
Agents cannot see or claim Ideas.”, and use the existing square, compact
panel/sheet visual language. Open cards use human attribution and accessible
ordering controls without Ready/Working/claim styling. Archive/Restore and
Promoted history remain human-only.

The promotion confirmation reads “Send this idea to Inbox?” and “This creates
one Intake item for agents to triage. The idea becomes Promoted and stays
linked.” Success reads **Idea sent to Inbox**; replay/terminal state reads
**Already in Inbox**. Preserve the linked navigation labels **View in Inbox**
and **Promoted from Ideas**. Dirty live conflicts retain the draft and finalized
uploads with **Keep my edits** and **Use latest**.

## Approved agent-auth adaptation

The prototype predates the accepted OAuth plan and displays a pairing code. Keep the connection screen's composition—host selector, copyable instruction, compact authorization card, live connection-status card, security note, and Overview action—but implement the accepted flows.

### CLI

1. The instruction asks the host to install dongo or run `dongo connect`.
2. The CLI detects the current repository and prepares a first-project proposal (name, safe repository URL when available, Manual/Autonomous mode), then requests an OAuth Device Authorization Grant and opens `verification_uri_complete` with that visible non-secret proposal.
3. The CLI selects an existing project from its explicit reference, the repository marker, repository URL, unique name/slug, or sole-project context. The browser route shows that fixed, non-editable binding alongside the requesting client, account, requested scopes, exact resource, short comparison code, and Approve/Deny actions. Ambiguity disables approval instead of presenting a project picker.
4. If no project exists, the primary action is “Create & approve.” It creates the proposed first project through the authenticated human identity, binds its stable public reference to the pending grant, and then approves. A missing or invalid proposal leaves approval disabled and offers the web fallback.
5. After approval the browser says “Approved — you can close this window,” and asks the user to return to the terminal while it finishes. It never displays access or refresh tokens, and the issued token is still project-bound.
6. The connection status updates when the CLI has stored credentials, written the non-secret project marker, and passed its connection check.

The complete URL is the normal one-link path. The short code exists for terminal/browser comparison and SSH recovery; users do not normally copy or enter it.

### MCP hosts

Codex, Claude Code, and generic MCP hosts use their own OAuth authorization-code flow with S256 PKCE against the project-specific MCP resource. Their grants and token families are separate from the CLI installation. The UI may reuse the same consent visual language, but it must accurately name the host and scopes.

### Removed prototype behavior

- no `pair with code …` instruction;
- no copied static token;
- no browser state that claims the terminal is connected before local credential storage and `doctor` succeed;
- no shared CLI/MCP credential.

## Fidelity and verification gate

- Build component fixtures for each screen and major state before live-data wiring.
- Verify desktop at 1180 × 760 and mobile at 402 × 812, then test fluid widths rather than hard-coding those dimensions.
- Compare computed typography, spacing, borders, colors, order, and state copy against the source HTML.
- Run keyboard, focus, reduced-motion, high-zoom, empty/loading/error, and route/back checks.
- Do not accept generic component-library defaults that visibly replace the supplied design.
