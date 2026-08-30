# Agent 04 — Web product

## Mission

After the agent protocol gate, implement the focused SolidStart human experience from the minimal live loop through the complete authenticated shell, capture, Overview, Work detail, Attention response, search, and administration, with responsive and accessible behavior.

The mandatory visual and responsive source of truth is [`../06-design-implementation-contract.md`](../06-design-implementation-contract.md) and the user-authored handoff it references. Preserve the supplied Dongo design language and adapt only the obsolete pairing interaction to the accepted OAuth device/consent flows.

## Exclusive ownership

- `apps/web/src/app.tsx` and route tree after Agent 01 creates the framework shell
- `apps/web/src/features/overview/**`
- `apps/web/src/features/intake/**`
- `apps/web/src/features/work/**`
- `apps/web/src/features/comments/**`
- `apps/web/src/features/attention/**`
- `apps/web/src/features/artifacts/**`
- `apps/web/src/features/search/**`
- `apps/web/src/features/recently-done/**`
- `apps/web/src/features/admin/**`
- co-located web unit/component tests

Auth/onboarding, Device Authorization/MCP consent, installation/grant management, and org/project setting internals belong to Agent 02. Upload implementation belongs to Agent 05; this agent integrates their feature adapters.

## Before the agent protocol gate

- Freeze routes, view models, route-backed panel/sheet behavior, responsive interaction rules, and complete fixtures without building full product breadth.
- After the CLI/MCP surface gate, connect only text Intake, minimal project status, and human Attention response needed by the agent walking skeleton.
- Do not make the full shell, media, search, administration, or visual polish a prerequisite for proving agent interoperability.

## Tasks

### W-01 — Authenticated shell

- After the agent walking-skeleton gate, add organization/project context, route/error boundaries, reconnect status, navigation, and session-expiry handling.

Acceptance:

- Anonymous users cannot render protected data.
- Project switching never flashes another project’s content.
- Shell renders feature fixtures without a live backend.

### W-02 — Overview

- Build Needs You, Working, Ready, Inbox, and Recently Done sections with zero-count collapse, stable order, actor/time labels, keyboard-accessible reorder, and truthful expired state.
- Open Work detail as a route-backed desktop side panel/mobile sheet.

Acceptance:

- Subscription updates move items without reload or duplicates.
- Needs You precedence is consistent.
- Back closes detail and restores Overview scroll/focus.
- Reorder conflict rolls back to canonical order with clear feedback.

### W-03 — Capture

- Build permanent Add Something composer, text submission, paste/drop/picker integration, local preview, optimistic Inbox, and Agent 05’s upload progress/retry/cancel states.

Acceptance:

- Text-only Intake submits in one action.
- Upload work does not block text entry.
- Final Intake never references an unfinalized object.
- Progress/errors are announced accessibly and previews are cleaned up.

### W-04 — Work detail and collaboration

- Render goal, actor/Run truth, source Intake, attachments, comments, artifacts, history summary, and Attention types.
- Implement optimistic comment, human response, separate resolve, conflicts, and safe external links/Markdown.

Acceptance:

- Direct link and Overview click produce the same view.
- Human response is durable and visibly attributed.
- Lost responses/retries do not duplicate comments.
- Concurrent changes cannot be silently discarded.

### W-05 — Search, Done, and administration

- Implement keyboard search, safe highlighting, pagination, Recently Done archive, members, project settings, execution mode, installation/grant UI from Agent 02, plan/quota state, and billing boundary when ready.
- Integrate CLI Device Authorization, MCP consent/status, reauthorization, doctor guidance, and revocation adapters without ever rendering access/refresh/device/authorization token material.
- Preserve pending device/MCP authorization across login/session refresh and return to the exact approval request.

Acceptance:

- Search is project-scoped, keyboard navigable, bounded, and injection-safe.
- Owner/member UI matches backend authorization.
- Installation metadata is visible; OAuth token material is never visible. One-time secrets exist only in the separate Advanced CI/service credential flow.
- UI does not advertise billing actions that do not exist.

## Cross-cutting acceptance

- Phone, tablet, and desktop share information hierarchy.
- Keyboard, screen reader, reduced motion, and high zoom are first-class.
- Ordinary optimistic mutations do not use full-page spinners.
- No hydration warning or unhandled console error is accepted.
- Feature adapters isolate presentation from low-level Convex calls.
