# Design implementation contract

Status: accepted implementation input. This document does not replace or modify the PRD.

## Source of truth

The user-authored handoff at [`user-journey-desktop-and-mobile/README.md`](user-journey-desktop-and-mobile/README.md) is mandatory for web implementation. Its primary design source is:

- [`project/Dongo Journey.dc.html`](user-journey-desktop-and-mobile/project/Dongo%20Journey.dc.html)
- the imported design runtime, [`project/support.js`](user-journey-desktop-and-mobile/project/support.js), is prototype infrastructure and is not shipped in the product;
- [`project/uploads/04-user-journey.md`](user-journey-desktop-and-mobile/project/uploads/04-user-journey.md) supplies the complete screen/state inventory beyond the interactive prototype.

The HTML is a behavioral and visual reference, not an application dependency. Rebuild it in the selected SolidStart stack with semantic components, real routes, real state, and accessible controls. Do not embed the prototype runtime or translate its inline styles mechanically.

## Visual contract

- Switzer is the primary UI typeface; the system fallback remains usable while it loads. Operational labels, identifiers, timestamps, shortcuts, and code use `ui-monospace, Menlo, monospace`.
- Core canvas is `#08080a`; elevated surfaces use `#0a0a0d` through `#15151a`; primary text is `#ececee`; subdued text follows the prototype's `#b9b9c1`, `#93939c`, `#7d7d87`, `#6c6c76`, `#5a5a63`, and `#4e4e57` hierarchy.
- Amber is `oklch(0.84 0.19 78)` and communicates Dongo identity, focus, current activity, and human Attention. Green is `oklch(0.82 0.20 150)` and communicates successful connection/completion.
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
- Needs You, Working, Ready, Inbox, and Recently Done;
- Inbox and Ready/Working/Needs You/Done detail;
- human Attention response and comments;
- search overlay/sheet and toast/status feedback.

The full journey document adds route-backed Completed, settings, installation access/revocation, members, plan/storage, archived/unavailable, offline/reconnecting/session-expired, conflict, and later native screens. Where the prototype omits one of those surfaces, extend its same typography, palette, spacing, borders, hierarchy, and interaction rules rather than introducing another visual system.

## Approved agent-auth adaptation

The prototype predates the accepted OAuth plan and displays a pairing code. Keep the connection screen's composition—host selector, copyable instruction, compact authorization card, live connection-status card, security note, and Overview action—but implement the accepted flows.

### CLI

1. The instruction asks the host to install Dongo or run `dongo connect`.
2. The CLI requests an OAuth Device Authorization Grant and opens `verification_uri_complete`.
3. The browser route shows the requesting client, selected project, requested scopes, short comparison code, expiry, and Approve/Deny actions.
4. After approval the browser says “Approved — return to your terminal.” It never displays access or refresh tokens.
5. The connection status updates when the CLI has stored credentials, written the non-secret project marker, and passed its connection check.

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
