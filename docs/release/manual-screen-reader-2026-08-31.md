# Manual VoiceOver acceptance — 2026-08-31

This document is the repeatable manual screen-reader gate for the development-only web candidate at `https://dev.dongo.so`. It does not claim a pass until every observation below is completed with macOS VoiceOver enabled. Automated Axe and accessibility-tree checks are complementary evidence, not substitutes.

## Safety and evidence boundary

- Enabling or disabling VoiceOver changes a user-level macOS accessibility setting. Obtain the product owner's explicit approval immediately before enabling it and restore the original state at the end.
- Use the signed-in development account and project `p58de816-dongo`; do not mutate production.
- Do not submit Intake, comments, Attention responses, uploads, or grant changes during this pass unless separately approved.
- Record observable names, roles, focus order, announcements, and any blocked task. Do not record private work content beyond the fixed synthetic identifiers named here.
- Stop on any focus trap, unnamed control, unexpected navigation, or state change that cannot be reversed safely.

## Environment

Record before starting:

- Candidate commit:
- Development web version:
- Browser and version:
- macOS version:
- Original VoiceOver state:
- Viewport and zoom:

Use Chrome at 1440×960 and 100% zoom for the desktop pass. Repeat the public root and authenticated Overview at 390×844 responsive emulation only after the desktop path succeeds.

## Pass A — public root and guides

1. Open `https://dev.dongo.so/` in a fresh tab.
2. Start reading from the top of the page.
3. Verify the skip link is announced first and moves focus to the main content.
4. Navigate by landmarks and headings. Confirm one main landmark, one level-one heading, meaningful section headings, and no empty landmark.
5. Navigate by links. Confirm **Get started**, **Open dongo**, **Sign in**, and **Help** are distinct and announce their destinations meaningfully.
6. Open `/get-started`, then `/help`. Confirm the page title and level-one heading change, code samples are understandable, and link names do not depend on surrounding visual copy.
7. At 390×844, confirm the essential navigation remains reachable and no control is announced only as an icon or symbol.

Expected result: a signed-out user can understand what dongo is, reach setup/help/authentication, and return home without searching visually.

## Pass B — sign-in surface

1. Open `https://dev.dongo.so/login` without submitting credentials.
2. Confirm the email field has an explicit accessible name and expected text-entry role.
3. Confirm Google and email actions have unambiguous names.
4. Move through the controls with normal VoiceOver navigation and keyboard Tab. Verify visible focus follows the announced item.
5. Do not trigger a provider flow during this audit.

Expected result: the complete sign-in choice is understandable and operable without visual context.

## Pass C — authenticated Overview and capture

1. Open `https://dev.dongo.so/open` and allow it to resolve to `p58de816-dongo`.
2. Navigate landmarks. Confirm the project navigation, capture region, work navigator, and main detail area have useful names and no duplicate main landmark.
3. Reach **Add something…** without using the pointer. Confirm its field, attach control, accepted-input hint, and submit action are announced in a coherent order.
4. Press `J` or Down to move to the first work item. Confirm the newly targeted row is announced and the visible keyboard target moves with it.
5. Press Up from the first work item. Confirm focus returns to capture.
6. Do not type or submit Intake.

Expected result: a human can discover capture and understand which issue keyboard navigation would open.

## Pass D — issue navigator and detail

1. From the work navigator, target `DONGO-1` and press Enter.
2. Confirm the detail heading is announced after the identifier and that the copy-ID control is named **Copy issue ID DONGO-1**.
3. Navigate through goal, source Intake, status, conversation, attachments, and comment composer. Confirm Markdown headings, lists, links, code, emoji, actor identity, and human/agent attribution retain semantic meaning.
4. Press Left from detail. Confirm focus returns to the open issue row in the navigator.
5. Press Down to target another issue. Confirm its identifier/title are announced while the open issue remains unchanged.
6. Press Left. Confirm focus returns to the issue already open, not the pending target.
7. Press `R`. Confirm focus moves to **Add a comment…** for the open issue.
8. Do not submit a comment or attachment.

Expected result: open issue, pending keyboard target, and comment action are distinguishable without relying on color or position.

## Pass E — human Attention

Run this only while a synthetic unresolved Attention is available.

1. Open the synthetic Attention work detail.
2. Confirm the waiting state, question, description, available decisions, optional response field, and Respond action are announced in logical order.
3. Select an option only if the product owner is independently completing that synthetic validation. Otherwise stop before selection.
4. If submitted by the product owner, confirm the waiting region disappears, the selected response is represented in the conversation, and focus does not fall back to the browser chrome or page root.

Expected result: the human can understand why the agent stopped, choose a response, and verify that the response was recorded.

## Pass F — overlays and recovery

1. Press `?`. Confirm the shortcuts dialog has an announced name, traps focus while open, closes with Escape, and returns focus to its trigger context.
2. Press Command-K. Confirm the command menu has an announced name, its options are navigable, Escape closes it, and focus returns.
3. Open Search with `/`. Confirm the search field is named, results announce identifier and title, and closing restores focus.
4. Confirm validation and connection errors use an assertive or status announcement without exposing raw provider or exception details.

Expected result: every overlay has a discoverable boundary, a keyboard exit, and reliable focus restoration.

## Completion record

For each pass record `pass`, `fail`, or `blocked` plus one concise observation. Any failure remains a release blocker until fixed and repeated on the exact candidate.

| Pass | Result | Observation |
|---|---|---|
| A — public root and guides | pending | |
| B — sign-in surface | pending | |
| C — authenticated Overview and capture | pending | |
| D — issue navigator and detail | pending | |
| E — human Attention | pending | |
| F — overlays and recovery | pending | |

After the pass, restore VoiceOver to its original state and record that restoration here:

- VoiceOver restored:
- Residual browser/system changes:

