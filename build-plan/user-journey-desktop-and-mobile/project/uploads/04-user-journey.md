# dongo V1 user journey — screen by screen

Status: product/UX description for planning. This document does not replace or modify the PRD.

## 1. Scope

This document describes what a human user sees and does from first sign-in through the complete dongo loop:

```text
sign in
  -> create project
  -> connect local coding agent
  -> submit raw intent
  -> watch the agent structure and execute work
  -> answer when needed
  -> review the result
```

The authenticated product has one primary operational screen: Overview. Work detail opens over Overview rather than taking the user into a project-management hierarchy. Settings, search, and completed history are secondary surfaces.

Marketing pages, legal pages, password recovery, roadmaps, boards, sprints, analytics, and custom workflow administration are outside this journey.

## 2. Experience rules across every screen

- Humans are never required to choose bug/feature/task type, workflow status, assignee, estimate, sprint, label, or acceptance criteria.
- Needs You is always the most visually prominent section when it contains items.
- Overview never duplicates an item: an item with open Attention appears under Needs You, while its underlying Ready/Working state remains visible in detail.
- Mutations appear immediately where safe and reconcile with Convex in the background.
- Ordinary actions do not cause full-page loading spinners.
- A stopped local agent is never presented as active. The UI says when work or Intake is waiting for a local agent.
- Desktop Work detail is a side panel. Mobile web Work detail is a full-screen sheet.
- Every icon-only control has an accessible label and visible focus treatment.
- Drag-to-reorder always has keyboard and button-based alternatives.
- Agent-authored Markdown, filenames, and external links are rendered safely.
- Destructive actions require clear confirmation.

## 3. Global web shell

The shell is deliberately small and has no permanent project-management sidebar.

### Desktop header

Visible elements:

- dongo wordmark, which returns to the current project Overview.
- Current organization and project selector showing the project name.
- Search button with its keyboard shortcut hint.
- Connection state only when relevant: Reconnecting, Offline, or Unable to sync.
- User avatar/profile menu.

The organization/project selector opens a compact popover containing:

- current organization name;
- current project with a selected checkmark;
- other available projects, if the plan allows them;
- Create project, when permitted;
- Organization settings;
- Project settings.

### Mobile web header

Visible elements:

- back control when a sheet/subscreen is open;
- dongo wordmark or current screen title;
- compact project selector;
- search icon;
- profile/avatar control.

The header does not show navigation for boards, roadmaps, analytics, or activity because those surfaces do not exist in V1.

### Profile menu

Visible elements:

- signed-in user name;
- email address;
- current organization and role;
- Organization settings;
- Project settings;
- Sign out.

## 4. First-time journey

### Screen 1 — Sign in

Purpose: let a human enter dongo without creating a password.

Visible elements:

- dongo wordmark.
- Short product statement: “See what your coding agents are doing, give them work, and answer when they need you.”
- Continue with Google button with Google mark.
- Divider labeled “or.”
- Email address field.
- Continue with email button.
- Small note that dongo uses a one-time code and does not require a password.
- Inline error region below the relevant control.

Primary actions:

- Continue with Google.
- Enter an email address and request a one-time code.

States:

- Invalid email: field remains populated and an inline validation message appears.
- Rate limited: action is disabled until the stated retry time.
- Service unavailable: page remains usable and presents Retry.
- Already authenticated: user is redirected to their last project or onboarding.

Next screen:

- Google continues through the provider and returns through the authentication callback state.
- Email continues to Screen 2.

### Screen 2 — Enter email code

Purpose: complete passwordless email authentication.

Visible elements:

- Back to sign in control.
- Heading: “Check your email.”
- Masked or full destination email.
- Six-character one-time-code input with one logical accessible label.
- Verify button.
- Resend code control with countdown when temporarily unavailable.
- Change email control.
- Inline status/error message area.

States:

- Verifying: Verify shows progress without replacing the screen.
- Incorrect code: code remains editable; error is announced.
- Expired code: Resend becomes the primary recovery action.
- Too many attempts: retry time is shown.
- Successful verification: user moves to onboarding or their last project.

### Screen 3 — Authentication callback

Purpose: provide a stable state while Google or email authentication is finalized.

Visible elements:

- dongo wordmark.
- Compact progress indicator.
- Text: “Signing you in…”

Error variant:

- Heading: “We couldn’t complete sign-in.”
- Human-readable reason when safe.
- Try again button.
- Back to sign in link.

The screen never flashes Overview data before the Convex identity is authenticated.

### Screen 4 — Create the first project

Purpose: establish the repository/codebase the user will coordinate.

The default planning behavior creates a personal organization automatically. Its name can be changed later; the user is taken directly to project creation.

Visible elements:

- dongo wordmark.
- Progress label: “Set up your workspace.”
- Heading: “Create your first project.”
- Explanation: “A project maps to one repository or codebase.”
- Project name field.
- Generated project slug preview.
- Optional repository URL field.
- Agent execution mode group:
  - Manual, selected by default, with text explaining that agents triage and suggest work but wait before starting;
  - Autonomous, with text explaining that agents may claim and begin Ready work.
- Free-plan note: one active project is included.
- Create project button.
- Sign out/profile escape action.

Validation and error states:

- Name required.
- Slug collision with suggested alternative.
- Invalid repository URL.
- Project entitlement reached, with an explanation rather than silent failure.
- Creation failure preserves every entered value and offers Retry.

Next screen: Screen 5.

### Screen 5 — Connect a coding agent

Purpose: connect the repository without making the user learn or construct API calls.

Visible elements:

- Success heading: “Project created.”
- Project name and identifier.
- Short instruction: “Open your repository with your coding agent and tell it to install dongo.”
- Host selector:
  - Codex;
  - Claude Code;
  - Generic AGENTS.md.
- Recommended natural-language instruction in a copyable block.
- Advanced/manual CLI option showing `dongo install`.
- Short-lived pairing code or pairing approval area.
- Pairing-code expiry indicator.
- Regenerate code control.
- Connection status card with states:
  - Not connected;
  - Waiting for pairing;
  - Verifying;
  - Connected, including agent type, machine label, and time;
  - Failed, including retry guidance.
- Security note that the project credential is stored locally and is never committed.
- Go to Overview button.
- Skip for now link.

The screen never displays a long-lived project token. A pairing code can be used once and expires.

Successful connection state additionally shows:

- checkmark and “Agent connected”;
- detected repository/project match;
- installed host adapter;
- Run connection check button;
- Continue to Overview button as the primary action.

### Screen 6 — First empty Overview

Purpose: teach the product through its empty state without a tour.

Visible elements:

- Global header.
- Large permanent Add Something composer at the top.
- Composer placeholder: “Add something…”
- Hint: “Bug, idea, screenshot, video or request.”
- Attachment button.
- Submit arrow/button, disabled until text or a finalized attachment is present.
- Empty-state message below the composer:
  - if no agent is connected: “Connect a local coding agent to turn new Intake into work,” with Connect agent action;
  - if an agent is connected but not running: “New Intake will wait for your local agent”;
  - if an agent is currently connected: “Add anything you want the agent to look at.”
- No empty section headings, because zero-item sections collapse.

The screen contains no chart, metrics, productivity score, board, sprint, or roadmap.

## 5. Creating Intake

### Screen 7 — Expanded Add Something composer

Entry: the user focuses the composer, pastes media, drops a file, or chooses an attachment.

Visible elements:

- Multi-line text field retaining the “Add something…” language.
- Text the user has entered.
- Attachment tray, when files are selected.
- Each attachment tile shows:
  - thumbnail or file-type icon;
  - filename;
  - file size;
  - upload state/progress;
  - remove/cancel control;
  - retry control after a recoverable error.
- Add attachment button opening image/video/file selection.
- Submit button.
- Compact note that no categorization is needed.

Supported user actions:

- Type or paste text.
- Paste one or more images.
- Drag/drop files on desktop.
- Select multiple images, a video, or a file.
- Remove an attachment.
- Retry an interrupted upload.
- Submit text immediately when no attachment is pending.
- Cancel by clearing the draft.

Validation states:

- Unsupported type: tile is rejected before upload where possible and explains why.
- File over 250 MB: tile is rejected with the limit.
- Quota exceeded: storage usage and the recovery/upgrade path are shown.
- Offline: draft remains local; upload and submit explain that a connection is required.
- Upload interrupted: completed parts are retained where supported; Retry resumes safely.
- Attachment still finalizing: Submit remains unavailable and explains what is pending.

### Screen 8 — Intake submitted

The user stays on Overview.

Visible changes:

- Composer clears only after the submission is safely accepted.
- A new optimistic row appears under Inbox immediately.
- The row shows:
  - the first line of raw text, or the primary filename if there is no text;
  - attachment icon/thumbnail and count;
  - submitted time;
  - status label “Waiting for local agent” or “Agent is triaging.”
- A brief success announcement/toast confirms submission without interrupting navigation.

If reconciliation fails:

- the optimistic row is marked “Not submitted”;
- Retry and Remove actions appear;
- the user’s text and attachment references remain recoverable;
- a retry uses the same mutation identity and cannot create a duplicate Intake.

### Screen 9 — Intake detail

Entry: the user opens an Inbox row.

Desktop: right-side panel over Overview. Mobile web: full-screen sheet.

Visible elements:

- Close/back control.
- Heading “Inbox.”
- Submitted timestamp and submitting human.
- Full original Intake text.
- Attachment gallery/list with preview/open/download actions.
- Current triage state:
  - Waiting for local agent;
  - Claimed by agent name with elapsed time;
  - Clarification needed;
  - Processed;
  - Dismissed.
- When claimed: agent name/avatar and lease-aware activity text.
- When processed: Linked work section listing every created or matched WorkItem.
- When dismissed: short agent explanation when supplied.

The user is not asked to classify or rewrite the Intake. Opening linked work moves to Screen 11.

## 6. Returning and populated Overview

### Screen 10 — Overview with active work

Purpose: answer “What needs me?”, “What is happening?”, and “What is waiting to happen?” immediately.

Visible elements, in order:

1. Global header.
2. Permanent Add Something composer.
3. Needs You section, if non-empty.
4. Working section, if non-empty.
5. Ready section, if non-empty.
6. Inbox section, if non-empty.
7. Recently Done section, if non-empty.

Each section heading contains its label and item count, except Recently Done where the compact history itself may be sufficient. Empty sections collapse completely.

#### Needs You rows

Each row shows:

- WorkItem title.
- Attention summary, such as “Claude needs a decision” or “Ready for approval.”
- Request kind: review, decision, question, or blocked.
- Important indicator when urgency is important.
- Requesting agent name/avatar.
- Relative age.
- Unseen indicator until the request is opened.

Selecting a row opens Screen 14.

#### Working rows

Each row shows:

- WorkItem title.
- Active agent name/avatar.
- Truthful elapsed activity time.
- Optional compact latest-update text when available.

An expired lease or stopped Run is not displayed as active. Selecting a row opens Screen 12.

#### Ready rows

Each row shows:

- Reorder handle/control.
- WorkItem title.
- Compact identifier where helpful.
- Current position implied by list order.

The list has no urgent/high/medium/low labels. Priority is expressed by ordering. Keyboard users can move an item up/down or to top/bottom through an action menu. Reorder conflict restores server order and explains the change.

Selecting a row opens Screen 11.

#### Inbox rows

Each row shows:

- Truncated raw Intake text or primary filename.
- Attachment type/count.
- Submitted time.
- Waiting, triaging, or clarification status.

Selecting a row opens Screen 9.

#### Recently Done rows

Each row shows:

- Completion checkmark.
- WorkItem title.
- Compact completed time.

The section shows roughly the latest 10–20 items and ends with View all, which opens Screen 16.

## 7. Work detail journey

### Screen 11 — Ready Work detail

Entry: user opens a Ready row or a direct WorkItem link.

Visible elements:

- Close/back control.
- WorkItem title.
- Identifier, such as `PROJ-143`.
- State line: Ready.
- Goal/description rendered as safe Markdown.
- Source Intake section with original text summary and attachment previews.
- Parent/related work when present.
- Conversation history.
- Existing artifacts, if any.
- Comment composer with Add comment action.
- Latest Events/history summary appropriate for humans.

The screen does not show a human assignment or status-management form. A human may comment or return to Overview and reorder the item.

### Screen 12 — Working Work detail

Visible elements:

- Everything from Ready Work detail that remains relevant.
- State line showing active agent and “working.”
- Current Run summary:
  - agent name/avatar;
  - started time and elapsed time;
  - latest meaningful update;
  - current claim/active indicator;
  - external session label when useful and safe.
- Latest section showing the agent’s most recent update.
- Files/artifacts section showing referenced files, commit, PR, preview, deployment, image, file, report, or URL.
- Conversation timeline with human and agent messages.
- Comment composer.

Stale activity variant:

- “Agent session stopped” or “Execution lease expired.”
- The screen does not continue counting elapsed active time.
- Underlying item is shown as reclaimable/Ready according to canonical server state.

The human does not stop or reassign the Run through hidden workflow controls. They may comment or wait.

### Screen 13 — Work update appears on Overview

This is a reactive state rather than a separate route.

Visible changes:

- A Ready item moves to Working without reload after an agent starts it.
- Agent name and elapsed time appear.
- A compact toast/announcement is optional but should not be noisy.
- Opening the row shows the new Run immediately.

Normal product events such as start, triage, comment, and completion appear in the relevant UI; they do not trigger email or push.

## 8. Human Attention journey

### Screen 14 — Needs You Work detail

Entry: user opens a Needs You row, follows a deep link, or taps a notification.

Visible elements:

- WorkItem title and identifier.
- Underlying state line, such as “Working · waiting for your decision.”
- Requesting agent name/avatar.
- Attention card placed before general history.
- Attention kind label: Review, Decision, Question, or Blocked.
- Request title.
- Full request body.
- Important marker when applicable.
- Requested time.
- Response control appropriate to the request:
  - text area for a free-form answer;
  - choice controls if structured options were provided;
  - Approve/Request changes controls for a review when applicable.
- Respond button.
- Owner/member-only Resolve without response action, visually secondary.
- Relevant goal, latest Run update, artifacts/preview/PR links, source Intake, and conversation history below the Attention card.
- General comment composer.

The screen does not imply that submitting an answer wakes a stopped local agent.

### Screen 15 — Attention response submitted

The user remains in Work detail.

Visible changes:

- The response appears in the conversation with human name/avatar and timestamp.
- The Attention card changes to Resolved/Answered.
- A line states: “Your agent will see this on its next pull.”
- The WorkItem disappears from Needs You in the underlying Overview.
- The underlying Ready/Working/waiting state remains visible.
- Optional Undo is not offered if it would make agent behavior ambiguous; the user can add a corrective comment instead.

Conflict/error states:

- Already resolved by another collaborator: canonical response is shown and the user’s draft remains copyable.
- Agent cancelled the request concurrently: the new comment can still be offered for submission, but the user is not told their answer resolved the old request.
- Offline/server failure: draft remains and Retry uses the same idempotency identity.

### Notification surfaces

When Attention is created:

- Needs You updates immediately in every connected client.
- If a native app is installed and enabled, a push notification is delivered immediately.
- If the request is Important and remains unresolved for 60 minutes, an email is sent.

Native push shows:

- dongo app name/icon.
- Neutral title such as “Claude needs a decision.”
- Project name when allowed by notification settings.
- No private request body or work content in the payload.

Important-attention email shows:

- dongo sender identity.
- Subject indicating unresolved human attention.
- Project and WorkItem title.
- Request type and concise safe summary.
- Open in dongo button linking to Screen 14.
- No status-change digest or unrelated activity.

## 9. Completion journey

### Screen 16 — Done Work detail

Entry: completion updates reactively, the user opens Recently Done, or follows a direct link.

Visible elements:

- WorkItem title and identifier.
- Done checkmark and completed timestamp.
- Completing agent name/avatar.
- Goal.
- Outcome summary.
- Source Intake summary and attachments.
- Artifacts list with typed icons and safe actions:
  - commit;
  - pull request;
  - deployment/preview;
  - URL;
  - image;
  - file;
  - report.
- Final Run summary and duration.
- Conversation history.
- Comment composer for follow-up context.
- Repository export status when known locally, such as “Synced to `.agent-work`” or “Will sync next time the local agent runs.”

There is no productivity score, velocity, or time-tracking judgment.

### Screen 17 — All completed work

Entry: View all from Recently Done.

Visible elements:

- Back to Overview.
- Heading: “Completed.”
- Search control or link to global search.
- Chronological list of completed WorkItems.
- Each row shows checkmark, title, identifier, completing agent, and completion time.
- Pagination/Load more control.
- Empty state when no work has completed.

Selecting a row opens Done Work detail as a route-backed panel/sheet.

## 10. Search journey

### Screen 18 — Search

Entry: search button, keyboard shortcut, or search route.

Desktop may present an overlay; mobile uses a full-screen sheet. The URL remains routeable when a result/detail is opened.

Visible elements:

- Back/close control.
- Search input with autofocus.
- Clear query control.
- Keyboard shortcut hint on desktop.
- Search scope text indicating the current project.
- Results area covering:
  - WorkItem title;
  - WorkItem description;
  - comments;
  - Intake text.
- Each result row shows:
  - result type icon/label;
  - WorkItem/Intake title or text excerpt;
  - safely highlighted matching text;
  - identifier/state where applicable;
  - relative date.
- Result count or continuation state.
- Load more/pagination control for bounded results.

States:

- Before query: short hint describing searchable content.
- Too-short query: prompt to type more.
- Searching: inline progress in the results area.
- No results: “Nothing found in this project.”
- Offline/error: Retry and preserved query.

Selecting a WorkItem result opens Work detail. Selecting Intake opens Intake detail. Escape/back returns focus to the original search trigger.

## 11. Project and organization administration

Settings are secondary routes. They are not part of the normal work loop.

### Screen 19 — Project settings: General

Visible elements:

- Back to Overview.
- Settings navigation: General, Agent access, Members/organization, Plan & storage as allowed by role.
- Project name field.
- Project slug.
- Optional repository URL.
- Agent execution mode:
  - Manual;
  - Autonomous.
- Save changes button.
- Project identifier/prefix, read-only when changing it would break durable references.
- Archive project section.
- Archive button and explanatory text.

Owner-only actions are unavailable to members. Archiving requires confirmation showing the project name and its effect on agent access.

### Screen 20 — Agent access

Visible elements:

- Project name and Agent access heading.
- Install/connect an agent action.
- Host guidance for Codex, Claude Code, and generic AGENTS.md.
- Credential/installations list.
- Each installation row shows:
  - name;
  - agent type;
  - machine/instance label when available;
  - created time;
  - last used time;
  - active/revoked state;
  - Revoke action.
- Generate pairing code action.
- Short-lived pairing card with expiry and Copy action.
- Connection-check/doctor guidance.

Creating or pairing a credential:

- secret material is displayed/exchanged only once;
- closing the one-time state cannot reveal it again;
- the persistent list shows metadata only.

Revocation confirmation shows the installation name and warns that its next request will fail.

### Screen 21 — Organization and members

Visible elements:

- Organization name field.
- Organization slug.
- Current user role.
- Members list.
- Each member row shows avatar, name, email, role, and Remove action when permitted.
- Invite member action.
- Pending invitations, if invitation support is included.
- Owner/member role explanation.
- Save organization action.

Invite flow elements:

- Email field.
- Role fixed to Member in V1 unless ownership transfer is explicitly supported.
- Send invitation button.
- Success/error state.

Members cannot manage billing, organization ownership, or project credentials unless the server-authorized role permits it.

### Screen 22 — Plan and storage

Visible elements:

- Current plan: Free or Paid.
- Active-project allowance and usage.
- Media storage allowance and current usage.
- Maximum individual upload reminder.
- Media retention summary when different by plan.
- Paid-plan benefits: multiple projects/organizations, larger storage, longer retention.
- Upgrade action when billing is enabled.
- Manage billing action for paid owners.
- Clear message when checkout/billing management is not yet available rather than a dead control.

The screen does not meter seats, agents, or WorkItems.

### Screen 23 — Archived or unavailable project

Archived variant:

- Heading that the project is archived.
- Explanation that agents can no longer create/claim work.
- Read-only access to existing work where permitted.
- Unarchive action for an authorized owner and available entitlement.
- Choose another project action.

Unauthorized/not-found variant:

- Generic “Project unavailable” heading that does not reveal whether a foreign project exists.
- Return to an available project action.
- Sign in with another account action when appropriate.

## 12. Native application journey

Native apps intentionally omit billing, organization settings, project creation, credential management, repo installation, and plugin setup.

### Screen 24 — Native sign in

Visible elements mirror web Sign in:

- dongo identity and short promise.
- Continue with Google.
- Email field and Continue with email.
- Native one-time-code entry state.
- Authentication errors and retry.

After sign-in, users with more than one project see a compact project chooser; otherwise they enter Overview.

### Screen 25 — Native Overview

Visible elements:

- Native top bar with project selector and profile/sign-out access.
- Permanent Add Something control.
- Needs You, Working, Ready, Inbox, and Recently Done in the same order and with the same row information as web.
- Search access if included in the native V1 client.
- Pull-to-refresh only as an explicit recovery affordance; live Convex updates remain primary.
- Offline/reconnecting state.

Ready ordering may use Move up/down actions rather than drag if that is more accessible and reliable on the platform.

### Screen 26 — Native capture sheet

Visible elements:

- Cancel/close.
- Text input.
- Camera/photo library action.
- Video/file picker action.
- Attachment tiles with preview, size, progress, retry, and remove.
- Submit action.
- Quota/validation/offline feedback.

Large uploads transfer directly to R2 and survive ordinary app interruption where the platform permits.

### Screen 27 — Native Work detail

Visible elements match the appropriate Ready, Working, Needs You, or Done web detail:

- title, identifier, underlying state;
- agent/Run truth;
- goal and source Intake;
- attachments;
- latest update;
- artifacts;
- Attention card and response controls;
- conversation/comment composer;
- completion outcome.

External artifacts open through safe platform link handling.

### Screen 28 — Push-to-response journey

1. The system push appears with neutral request metadata.
2. The user taps it.
3. If signed out, native authentication completes and preserves the intended deep link.
4. The app opens the correct project and WorkItem directly at the Attention card.
5. The user reads context, enters/selects a response, and taps Respond.
6. The response appears attributed in the conversation.
7. The UI states that the local agent will see it on its next pull.
8. Back returns to Overview, where the item no longer appears under Needs You.

Invalid deep-link states:

- Request already resolved: show the resolved response and current Work detail.
- Project access removed: show Project unavailable without leaking data.
- WorkItem deleted/cancelled: show the canonical current state.
- Offline: retain the response draft and offer Retry when connected.

## 13. Cross-product system states

### Offline

Visible elements:

- Persistent but compact Offline status.
- Last successfully loaded data remains visible where safe.
- Read-only navigation continues.
- Mutations that cannot be safely queued explain that a connection is required.
- Draft text is retained locally.
- The product never falsely says work was claimed, started, answered, or completed.

### Reconnecting

Visible elements:

- Reconnecting indicator in the shell.
- Existing content does not disappear.
- Optimistic records remain visibly pending.
- After reconnection, records reconcile exactly once.

### Session expired

Visible elements:

- Sign-in-required sheet/page.
- Explanation that the session expired.
- Sign in action.
- Unsaved local draft preserved when feasible.
- After authentication, return to the intended project/screen if still authorized.

### Permission changed

Visible elements:

- Owner-only control disappears or becomes unavailable after canonical state updates.
- Attempted action returns a clear permission message.
- Project content is removed immediately when membership is lost.

### Empty sections and empty search/history

- Empty Overview sections collapse.
- A completely empty Overview teaches capture through the composer rather than showing five empty boxes.
- Empty Completed and Search screens state what will appear there and provide Back to Overview.

### Server conflict

Visible elements:

- Canonical current state replaces stale optimistic state.
- Specific message explains that another person/agent changed the item.
- The user’s draft remains copyable/retryable where possible.
- The product never silently overwrites another actor.

## 14. Complete golden user journey

The V1 journey is complete when the following feels continuous:

1. René signs in with Google or an email code.
2. dongo creates a personal organization and René creates the dongo project.
3. René opens the connection screen and tells Codex or Claude Code to install dongo.
4. The local installer pairs through a one-time code and the screen confirms the connection.
5. René enters Overview and types “checkout gets stuck here,” attaches a screen recording, and submits.
6. The Intake appears immediately under Inbox as Waiting for local agent.
7. Later, the local agent starts, pulls the project, claims Intake, inspects the repository/media, and creates useful WorkItems.
8. Overview reacts: the raw Intake links to structured Ready work.
9. The agent claims the highest appropriate item after human direction; Overview shows the item under Working with truthful agent activity.
10. The agent discovers a migration decision and requests Attention.
11. The item moves to Needs You, and René receives push when a native client is installed.
12. René opens the item, sees the request in context, answers, and the response is recorded in the conversation.
13. dongo states that the local agent will see the response on its next pull.
14. The agent continues, finishes, and attaches its commit/PR/preview artifacts.
15. Overview moves the item into Recently Done.
16. René opens it and sees the goal, outcome, artifacts, conversation, source Intake, and completion details.
17. The next local sync writes the durable, human-readable `.agent-work` Markdown file into the repository.

At no point did René classify the Intake, assign an agent, choose a workflow state, create acceptance criteria, maintain a board, or manage a sprint.

