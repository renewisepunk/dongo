# dongo V1 user journey — screen by screen

Status: product/UX description for planning. This document does not replace or modify the PRD.

## 1. Scope

This document describes what a human user sees and does from first sign-in through the complete dongo loop:

```text
sign in
  -> create project
  -> authorize the CLI from one terminal-opened browser link
  -> connect Codex or Claude through remote MCP OAuth
  -> submit raw intent
  -> watch the agent structure and execute work
  -> answer when needed
  -> review the result
```

The authenticated product eventually has one primary operational screen: Overview. Work detail opens over Overview rather than taking the user into a project-management hierarchy. Before the agent protocol gate, the live web surface is intentionally limited to authentication, project selection, CLI/MCP approval, installation revocation, text Intake, minimal status, and Attention response. Settings breadth, search, completed history, media, and the full shell follow after CLI and MCP interoperability passes.

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
- Visible Ideas link to the current project's human-only backlog.
- Search button with its keyboard shortcut hint.
- Connection state only when relevant: Reconnecting, Offline, or Unable to sync.
- User avatar/profile menu.

The organization/project selector opens a compact popover containing:

- current organization name;
- current project with a selected checkmark;
- other available projects, if the plan allows them;
- current plan and active-project allowance;
- Create project for owners, even when the allowance is full, so the destination can explain the limit and recovery choices instead of hiding the action;
- Organization settings;
- Project settings.

### Mobile web header

Visible elements:

- back control when a sheet/subscreen is open;
- dongo wordmark or current screen title;
- compact project selector;
- Ideas action when the Ideas route is not already open;
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
- Help;
- Sign out.

### Desktop keyboard operation

The web Overview supports `C` Capture, `/` Search, `J`/Down Next, `K`/Up Previous, Left to toggle focus between the open wide detail and its selected sidebar row without activating a different pending row, `Enter` Open and return keyboard focus to wide detail, `Space` Peek without changing the route, `Esc` Close, `R` Respond/review, `W` Move to Working, `D` Mark Done, `E` Edit, Command/Ctrl+Enter Submit, Command/Ctrl+K Command menu, and `?` Show shortcuts.

Single-key shortcuts pause while the user is typing in an input, textarea, select, or editable region. Selection has a visible focus state, dialog focus is trapped and restored, and shortcuts do not invent unsupported mutations: `W` and `D` explain that canonical Run state is agent-owned, while `E` directs the human to add a corrective comment until human editing has a real contract.

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
- When sign-in began inside Device Authorization or MCP consent, successful verification returns to that exact pending request rather than onboarding/Overview.

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

When authentication was initiated by `/device` or `/oauth/consent`, the callback preserves the pending authorization transaction and returns to it. The user is never forced to restart the terminal or MCP login flow after authenticating.

### Screen 4 — Create a project (web fallback)

Purpose: establish the repository/codebase the user will coordinate.

This is the web-started fallback, not a mandatory gate before an agent can authenticate. The canonical agent-first path is Screen 5B → Screen 5C, where `dongo connect` proposes the repository as the first project and the human creates and approves it in one consent action. The first-project fallback creates a personal organization automatically; a later project is created in an explicitly selected owner organization.

Visible elements:

- dongo wordmark.
- Progress label: “Set up your workspace.”
- Heading: “Create your first project” or “Create another project,” based on durable project state.
- Authenticated account identity and explicit copy distinguishing account sign-in from project/repository binding.
- Explanation: “A project maps to one repository or codebase.”
- Organization selector when the person owns more than one organization.
- Current plan, active-project usage, and exact allowance before submission.
- Project name field.
- Generated project slug preview.
- Optional repository URL field.
- Agent execution mode group:
  - Manual, selected by default, with text explaining that agents triage and suggest work but wait before starting;
  - Autonomous, with text explaining that agents may claim and begin Ready work.
- Create project button.
- Sign out/profile escape action.

Validation and error states:

- Name required.
- Slug collision with suggested alternative.
- Invalid repository URL.
- Project entitlement reached, with a specific Free-plan explanation and actions to use the existing project, archive an active project, or review plan/upgrade availability. The user stays authenticated and is never sent to login as a remedy for an allowance failure.
- Creation failure preserves every entered value and offers Retry.

Next screen: Screen 5. The created project is stored as the selected project before navigation, and the destination gives concrete repository/agent connection steps. When this fallback was opened from a legacy pending CLI/MCP authorization, the exact pending request remains in `returnTo`; the new project stays selected when the user returns.

### Screen 5A — Web: connect a coding agent

Purpose: explain the terminal-first setup without exposing API or token mechanics.

Visible elements:

- Success heading: “Project created” or “Connect an agent.”
- Project name and non-secret public reference.
- Primary instruction: “In your repository, run `dongo connect`.”
- Copy command action.
- Explanation: “dongo will open one secure browser link. Approve the project, then return to your terminal.”
- Host options for dongo CLI, Codex MCP, Claude MCP, and generic MCP.
- Connection status summary for independently authorized installations.
- Security note: credentials are stored by the CLI or MCP host and are never committed.
- Skip for now and Open minimal project status actions.

This screen never generates or displays a project token or pairing code.

### Screen 5B — Terminal: start CLI connection

Entry: the user runs `dongo connect` from the repository.

Visible terminal elements:

- Detected repository path and environment.
- Inferred first-project proposal: repository-derived project name, safe Git origin URL when available, and Manual execution mode by default.
- Optional deterministic overrides: `--project-name`, `--repository-url`, and `--execution-mode manual|autonomous`.
- “Requesting secure authorization…” status.
- One complete clickable authorization URL, opened automatically when possible.
- Short confirmation code shown for comparison with the browser.
- “Waiting for approval…” state with expiry.
- Safe instruction for SSH/headless use: open the same complete URL on any browser; the terminal keeps polling.
- Cancel instruction.

No token, device credential, or authorization code is printed. Normal setup requires no code copy/paste.

Terminal error/recovery states:

- Browser could not open: print the complete URL and continue polling.
- Authorization pending: remain quiet except for bounded progress.
- Server requests `slow_down`: back off to the returned interval.
- Denied or expired: explain the result and offer a fresh authorization.
- Network interrupted: retry safely until expiry.
- Cancelled: stop polling and leave no partial credential.
- Unsafe or credential-bearing repository origin: omit the repository URL from the proposal rather than placing it in browser history; an explicitly supplied unsafe URL fails before authorization starts.

### Screen 5C — Browser: approve dongo CLI

Purpose: let the authenticated human authorize one terminal installation for one project.

Visible elements:

- Heading: “Authorize dongo CLI.”
- Confirmation code, with instruction to ensure it matches the terminal.
- Authorizing account and organization.
- Verified client name: dongo CLI.
- Repository/machine label when safely supplied.
- Fixed project selected by the CLI/agent from an exact reference, the repository marker, repository URL, unique name/slug, or the account's only active project. The human confirms this binding but does not choose it on the consent page.
- If an account has multiple projects and repository context does not resolve exactly one, show “No unambiguous project match,” disable approval, and tell the agent to reconnect with an exact public project reference.
- When no project exists and the current official CLI link contains a valid proposal: a clearly labeled CLI project proposal showing name, repository URL when present, and Manual/Autonomous mode; Requested access explicitly includes creating that first project; the primary action reads “Create & approve.”
- When an explicit `dongo project create` request contains a valid proposal: do not match or reuse an existing project. Show the target owner organization and allowance, create a new project, bind the terminal to the resulting public project reference, then approve.
- When the selected organization has reached its Free-plan active-project allowance: disable Create & approve and show use-existing, archive-existing, and plan/upgrade actions without restarting authentication.
- When no project exists and the request has no valid proposal: approval stays disabled and the web Create project fallback is available.
- Requested access in plain language, including read/write and offline renewal where applicable.
- Exact API resource/environment.
- Approve and Deny buttons.
- Warning not to approve an unexpected request or a code received from someone else.

States:

- Sign-in required: complete Google/email sign-in and return to this request.
- Wrong account/no project permission: choose another account or deny without revealing foreign project data.
- No available project/entitlement reached: explain the limitation and allow project management in a separate tab.
- Invalid, already used, denied, or expired request: show a terminal retry instruction.

For any project creation request, Create & approve provisions the project through the authenticated Convex identity, binds its resulting public project reference to the authorization-server user, and only then approves the device request. A first project also provisions the personal organization. Approval creates a separate project-scoped installation Actor and grant. It never issues an account-wide work token and never reveals token material.

### Screen 5D — Browser: authorization complete

Visible elements:

- Checkmark.
- Heading: “Approved.”
- Project and client name.
- Message: “Return to your terminal to finish connecting.”
- Close tab action.

This screen says Approved rather than Connected because local secure storage, repository configuration, and doctor can still fail.

### Screen 5E — Terminal: finish CLI connection

Visible terminal elements:

- “Authorization approved.”
- Secure-storage step.
- Non-secret project-marker step.
- Read-only `session_start`/connection check.
- Final success with project, installation label, scopes/access profile, and safe expiry/status summary.
- Optional commands: `dongo auth status`, `dongo doctor`, `dongo sync`.

If secure storage or a later step fails, the terminal reports completed steps and a resumable recovery. It never falls back to writing a token in the repository.

### Screen 5F — Terminal/TUI: connect Codex or Claude MCP

Purpose: add the hosted remote MCP server as a separate, independently revocable installation.

Visible elements:

- A preview of the dongo-owned project configuration and managed instructions,
  without dumping unrelated host configuration.
- The selected host and project in plain language; raw transport, grant, and
  resource details stay in the explicit technical preview rather than the
  human-facing progress state.
- One ordered setup sequence:
  1. Apply the configuration.
  2. Approve the project-scoped server only if required.
  3. Complete login only if required.
  4. Restart only when necessary.
  5. Verify the connection with `dongo_session_start`.
- A warning that each MCP host receives its own access and the CLI credential is
  never copied or reused.

`dongo integrate codex` and `dongo integrate claude` may automate safe configuration merges, launch host-native login, install managed instructions, and run a read-only verification. They must show the exact files/settings they will change and rollback instructions.

The selected MCP host is not marked connected because a CLI installation is
active. Success requires a live, active installation for that host plus a
successful `dongo_session_start`. Pending project trust, missing or expired
login, a required reload, revoked access, and verification failure each name the
specific next step. A working repository session is never told to restart unless
the host cannot load the newly applied connection.

### Screen 5G — Browser: approve MCP host

Purpose: authorize Codex, Claude, or another MCP client through the standard authorization-code + S256-PKCE flow.

Visible elements:

- Client/host name and verified client metadata when available.
- Authorizing account and organization.
- Exactly one selected project.
- Requested scopes/access profile in plain language.
- Exact project-specific MCP resource URL.
- Approve and Deny.
- Unexpected-request warning.

The grant/token family and installation Actor are distinct from the dongo CLI and from every other MCP host. Error states cover discovery/registration failure, invalid redirect/state/PKCE, pending host project approval, insufficient scope, audience mismatch, revoked refresh, configuration-name collision, and unsupported host version.

### Screen 5H — Terminal/TUI: verify connected agent surfaces

Visible elements:

- CLI connection status and read-only `session_start` result in plain language.
- Each configured MCP host with Connected, Needs authentication, Pending project trust, Needs reauthorization, Revoked, or Failed status; raw grant and transport details are not shown in the default progress view.
- Tool count and verification of `dongo_session_start` where the host exposes it.
- Doctor/retry/reauthorize guidance.
- Open dongo action only after the selected surface verifies successfully.

### Screen 6 — First empty Overview after the agent protocol gate

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
- Drag files anywhere over the desktop app; the entire viewport becomes a visible drop zone, and dropping attaches the files to the new Intake without submitting it.
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
- File drag in progress: a full-viewport “Drop to attach” layer clearly shows that the file will be added to the new issue; it disappears on drop or when the pointer leaves the app.

### Screen 8 — Intake submitted

The user stays on Overview.

Visible changes:

- Composer clears only after the submission is safely accepted.
- A new optimistic row appears under Inbox immediately.
- The row shows:
  - the server-authoritative non-empty label: first nonblank normalized text
    line, otherwise the first available filename, otherwise `Untitled intake`
    for legacy/deleted-data edge cases;
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
- Current Intake text, optional context, and links.
- Attachment gallery/list with preview/open/download actions.
- Submitting human plus created/updated timestamps; immutable history attributes
  each saved edit to its human Actor without inventing a `lastEditedBy` field on
  the Intake.
- Current triage state:
  - Waiting for local agent;
  - Claimed by agent name with elapsed time;
  - Clarification needed;
  - Processed;
  - Dismissed.
- When claimed: agent name/avatar and lease-aware activity text.
- When processed: Linked work section listing every created or matched WorkItem.
- When dismissed: short agent explanation when supplied.

While the Intake is waiting or claimed, any authorized project member can enter
Edit, change text/context/links, and add finalized attachments. Existing
attachments are retained; removal is outside this slice. The editor sees an
explicit **Save Intake** action and Saving, Saved, validation, and failure
states. Saving is unavailable when the resulting Intake would have neither text
nor an available attachment, while an added attachment is pending or failed, or
when a link is not a valid HTTP(S) URL. Duplicate normalized links collapse and
the Intake may contain at most 100 links.

Saving a claimed Intake keeps the agent claim but advances the shared revision.
The live subscription updates the detail and every Inbox/search/source label. If
another human or agent changes the Intake while an edit draft is open, the
canonical version remains visible, the draft is preserved, and the editor is
offered explicit retry/merge rather than an overwrite. Processed and dismissed
Intake is read-only; a save that races with triage completion explains that the
Intake can no longer be edited.

The user is not asked to classify the Intake. Opening linked work moves to
Screen 11.

## 5A. Human Ideas backlog

Ideas are deliberately separate from Add Something and Inbox. Capturing an Idea
does not create Intake, notify an agent, enter Overview, or authorize work. The
route is `/app/:orgSlug/:projectSlug/ideas`; selected detail uses
`?idea={ideaId}` and follows the same desktop panel/mobile sheet behavior as
other route-backed detail.

### Screen 9A — Ideas list

Entry: visible **Ideas** link in the project header.

Visible elements:

- Heading **Ideas**.
- Lede: “Possible future work. Agents cannot see or claim Ideas.”
- Primary **Capture idea** action.
- Filters **Open**, **Archived**, and **Promoted**; Open is the default.
- Open Ideas in explicit manual position order.
- Archived and Promoted history ordered by newest state transition first.
- Each card shows title, optional content/attachment summary, creating or latest
  editing member attribution and time, and state where applicable.
- Open cards expose accessible Move earlier/Move later controls. They never use
  Ready, Working, claim, Run, or agent-assignment language.

List subscriptions update without reload. A reorder submits the complete open
order with current revisions. If another member changes the list first, restore
canonical order, keep the intended move understandable, and offer a deliberate
retry rather than overwriting.

### Screen 9B — Capture or edit Idea

The editor contains:

- required **Title**;
- optional **Idea** text with Markdown support and formatted preview;
- optional **Context**;
- **Links**, normalized HTTP(S) URLs;
- finalized attachments with upload progress, retry, and additive attachment
  behavior;
- primary **Capture idea** for create or **Save changes** for edit.

An Idea may contain up to 100 links and 20 finalized attachments. Existing
attachments remain associated; removal is outside this slice. Attribution
shows the creating member and latest editing member. Local text/context/link
drafts are scoped to the Idea; the editor may say “Draft saved on this device.”
Uploads remain visible until finalized or retried.

Only Open Ideas are editable. Clean live updates replace the displayed state.
When a live update or stale save races with a dirty editor, preserve text and
finalized uploads and show “This Idea changed elsewhere. Your unsaved edits and
finalized uploads are still here.” with **Keep my edits** and **Use latest**.
Never silently overwrite either member.

### Screen 9C — Archive, restore, and promote

Open detail offers **Edit** and **Archive**. Archived detail is read-only and
offers **Restore**. Promoted detail is terminal and shows **Already in Inbox**
plus **View in Inbox**.

Promotion is a deliberate human action. Confirm with heading “Send this idea to
Inbox?” and copy “This creates one Intake item for agents to triage. The idea
becomes Promoted and stays linked.” On acceptance, atomically create one Intake
from the canonical current Idea, move the Idea to Promoted, and preserve the
two-way link. Success says **Idea sent to Inbox** with **View in Inbox**.

An exact replay or any later promotion request opens the original Intake and
shows **Already in Inbox**; one Idea can never create a second Intake. The Intake
detail links back with **Promoted from Ideas**. Promotion does not assign, claim,
notify, or authorize an agent to start. Agents see only the resulting Intake
through the normal Intake workflow.

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
- Canonical Work identifier.
- Active agent name/avatar.
- Running or Waiting Run state.
- Truthful elapsed activity time.
- Optional compact latest-update text when available.
- Lease health when degraded or nearing expiry.
- Safe workspace label: `Worktree · <branch>` when a branch is supplied,
  otherwise `Worktree · <worktree name>` when its safe label is supplied,
  `Isolated workspace` when isolation is supported without display details, or
  `Workspace details unavailable` otherwise.

An expired lease or stopped Run is not displayed as active. Selecting a row opens Screen 12.

The expanded live region is headed `agent activity` with “Live claimed work
across connected agent sessions.” Cards use the actual agent Actor, canonical
Work identifier/title, Running/Waiting, latest progress or `No progress update
yet.`, elapsed time, and lease state `Lease healthy`, `renewing`, `released`, or
`expired`. Unsupported/undisclosed capability explicitly stays serial; a shared
checkout says additional work stays serial. If the concurrency query fails,
state that activity is temporarily unavailable while keeping canonical Working
navigation usable.

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

- The shared server-authoritative Intake label: first nonblank normalized text
  line, first available filename, or the neutral `Untitled intake` fallback.
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
- Canonical identifier, such as `dong143`.
- State line: Ready.
- Goal/description rendered as safe Markdown.
- Source Intake section with original text summary and attachment previews.
- Parent/related work when present.
- Conversation history.
- Existing artifacts, if any.
- Comment composer with Add comment action.
- Comment attachments using the same secure upload lifecycle as Intake: paste an image, drop one or more files on the composer, or choose files explicitly. Each file shows preview/type, progress, ready/error state, Retry, and Remove. The comment remains disabled while uploads are pending or failed and may contain text, finalized attachments, or both.
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
  - safe workspace label without an absolute local path.
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
- General comment composer with pasted-image, file-drop, and file-picker attachments. Submitted attachment references appear on the attributed conversation entry and are available to authorized agents through the canonical attachment API.

The screen does not imply that submitting an answer wakes a stopped local agent.

### Screen 15 — Attention response submitted

The user remains in Work detail.

Visible changes:

- The response appears in the conversation with human name/avatar and timestamp.
- The Attention card changes to Resolved/Answered.
- A line states: “Your agent will see this on its next explicit pull. An active dongo waiter checks with backoff for up to five minutes; a stopped agent will not restart itself.”
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
  - canonical WorkItem identifiers and exact retained legacy identifier aliases;
  - WorkItem title;
  - WorkItem description;
  - comments;
  - Intake text.
- Ideas remain in their dedicated human backlog and are not part of global or
  agent search; their state filters and manual Open ordering live on Screen 9A.
- Each result row shows:
  - result type icon/label;
  - WorkItem/Intake title or text excerpt;
  - safely highlighted matching text;
  - identifier/state where applicable;
  - relative date.
- WorkItem results always display and copy the canonical compact identifier,
  even when the query matched an exact value from `legacyIdentifiers`.
- Result count or continuation state.
- Load more/pagination control for bounded results.

States:

- Before query: short hint describing searchable content.
- Too-short query: prompt to type more.
- Searching: inline progress in the results area.
- No results: “Nothing found in this project.”

### Screen 18A — Help and shortcut reference

Entry: Help in the avatar menu, Help in the command menu, or `?` for the compact shortcut dialog.

The route-backed Help page shows:

- a concise explanation of the capture → agent work → Needs You → result loop;
- how to connect the CLI and independently authorized MCP hosts;
- the complete keyboard shortcut reference;
- a return-to-Overview action.

The `?` shortcut opens the same reference as a focus-trapped dialog over Overview. The dialog and command menu close with `Esc` and restore focus to the invoking control or selected row.
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
- Agent concurrency:
  - **Single-agent** by default;
  - owner-only **Allow parallel work** opt-in;
  - supporting copy: “Agents may work on separate claimed items at the same
    time when their host supports isolated workspaces.”;
  - `maxConcurrentRuns` safety cap from 2 through 8, defaulting to 4 when
    enabled, labeled **Maximum concurrent runs** and **Safety cap**, with
    explicit copy that it is `not a plan limit`;
  - explanation that dongo coordinates atomic claims and Runs while the host
    creates agents and worktrees.
- Save changes button.
- Compact four-letter project code, read-only and derived from the immutable
  lowercase slug, with any legacy prefix retained only as compatibility
  metadata for exact old-identifier lookups.
- Archive project section.
- Archive button and explanatory text.

Owner-only actions are unavailable to members. Archiving requires confirmation showing the project name and its effect on agent access.

Unsupported or undisclosed hosts remain available for serial work. Settings do
not promise that enabling parallel work can make such a host spawn agents or
worktrees. Live cards appear and change through authoritative project
subscriptions; they do not appear merely because a CLI process is connected.

### Screen 20 — Agent installations and access

Visible elements:

- Project name and Agent installations heading.
- Connect another CLI, Connect Codex MCP, Connect Claude MCP, and Generic MCP actions.
- Project-specific MCP endpoint and non-secret host guidance.
- Installation/grant list with one row per CLI, Codex, Claude, generic MCP, or CI/service installation.
- Each installation row shows:
  - name;
  - client/host type;
  - project and configuration scope;
  - machine/instance label when available;
  - access profile/scopes;
  - authorized by;
  - created time;
  - last used time;
  - pending, active, needs reauthorization, or revoked state;
  - Reauthorize or Doctor guidance where relevant;
  - Revoke action.
- Advanced CI/service credential section for explicitly non-interactive use.
- Local host cleanup/uninstall instructions.

Interactive authorization:

- OAuth access/refresh/device/authorization token material is never displayed;
- each client gets a separate project-scoped grant and installation Actor;
- the persistent list shows metadata only;
- server Revoke invalidates the grant/token family but does not remove local CLI/Codex/Claude configuration or managed instruction files.

Creating an Advanced CI/service credential:

- the secret is displayed once;
- closing the one-time state cannot reveal it again;
- the credential is labeled non-interactive and is never recommended for CLI or MCP login;
- the persistent list shows metadata only.

Revocation confirmation shows the installation name and warns that its next server request will fail. It also links to separate local cleanup instructions.

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

Members cannot manage billing, organization ownership, agent installations, or CI/service credentials unless the server-authorized role permits it.

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

Native apps intentionally omit billing, organization settings, project creation, agent-installation and CI/service-access management, repo installation, and MCP host setup.

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

The live subscription is authoritative when a human and agent act on the same
item. dongo applies additive comments independently. For revision-sensitive
actions such as Ready ordering and Attention resolution, the first accepted
write wins; a stale write is rejected, the current server state remains on
screen, and the interface names the concurrent change. Comment and Attention
response text autosaves locally per project and Work item, is cleared only
after a successful write, and remains available to copy when the competing
change makes retry impossible.

## 14. Complete golden user journey

The V1 journey is complete when the following feels continuous:

1. In the repository, René runs `dongo connect`; the CLI detects the dongo repository, proposes the dongo project, opens one complete browser link, and displays a matching confirmation code.
2. René signs in with Google or an email code if needed. No pre-existing project is required to reach the authorization review.
3. The browser shows the exact CLI proposal, scopes, account, resource, and comparison code. René chooses Create & approve; dongo creates the personal organization and first project, binds that project to the pending device request, and approves it.
4. René returns to the polling terminal. The CLI receives only the new project-scoped grant, securely stores it, writes only a non-secret marker, and passes doctor. If the project already existed, the agent selects it from repository context before opening the link; the browser shows that fixed binding for confirmation and Approve without creating anything.
5. René connects Codex or Claude to the project-specific remote MCP endpoint. The host opens a separate OAuth consent request; René approves that host for the same project, and a read-only `dongo_session_start` verifies it.
6. René enters Overview and types “checkout gets stuck here,” attaches a screen recording, and submits.
7. The Intake appears immediately under Inbox as Waiting for local agent.
8. Later, the authorized CLI or MCP agent starts, pulls the project, claims Intake, inspects the repository/media, and creates useful WorkItems.
9. Overview reacts: the raw Intake links to structured Ready work.
10. The agent claims the highest appropriate item after human direction; Overview shows the item under Working with truthful agent activity.
11. The agent discovers a migration decision and requests Attention.
12. The item moves to Needs You, and René receives push when a native client is installed.
13. René opens the item, sees the request in context, answers, and the response is recorded in the conversation.
14. dongo states that the local agent will see the response on its next pull.
15. The agent continues, finishes, and attaches its commit/PR/preview artifacts.
16. Overview moves the item into Recently Done.
17. René opens it and sees the goal, outcome, artifacts, conversation, source Intake, and completion details.
18. The next authenticated CLI sync writes the durable, human-readable `.agent-work` Markdown file into the repository; remote MCP alone never claims that a local file was written.

At no point did René classify the Intake, assign an agent, choose a workflow state, create acceptance criteria, maintain a board, or manage a sprint.
