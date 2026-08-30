# PRD — Dongo (dongo.so) Agent-First Work Tracker
**Version:** V1  
**Status:** Implementation-ready  
**Working product description:** A minimal shared workspace where humans dump intent, coding agents turn it into structured work, and humans can instantly see what is happening and what needs their attention.

---

## 1. Product thesis

Traditional issue trackers are designed around humans creating, organizing, assigning, and managing work.

This product assumes something different:

**Humans provide intent and judgment.  
Agents provide structure and execution.**

A human should be able to:

- dump a thought
- report a bug
- upload a screenshot
- upload a screen recording
- ask for something to be changed
- review what an agent has done
- answer a question
- approve or redirect work

They should not need to:

- classify issues
- choose statuses
- assign agents
- create acceptance criteria
- maintain boards
- groom backlogs
- manage sprints
- organize project-management metadata

The coding agent does those things locally, using the repository as context.

The SaaS itself performs **no AI inference**.

---

# 2. Core product promise

The product answers three questions immediately:

1. **What needs me?**
2. **What is happening?**
3. **What is waiting to happen?**

Everything important should be understandable from a single primary screen:

# Overview

There is no dashboard, project board, analytics screen, sprint view, roadmap, or activity center in V1.

---

# 3. Product principles

## 3.1 Agent-first

The agent API is a primary product surface, not an integration added later.

Claude Code, Codex, OpenCode, Cursor agents and future coding agents should be able to operate the system with a tiny documented toolset.

Agents should need fewer concepts than they currently need to operate Linear.

---

## 3.2 Human-simple

Humans should never need to understand the internal workflow in order to contribute something.

The primary human creation mechanism is:

> **Add something…**

Text, image, video or file.

The system does not ask whether it is a feature, bug, task or idea.

---

## 3.3 No hosted AI

The SaaS:

- does not call Anthropic
- does not call OpenAI
- does not classify intake
- does not generate descriptions
- does not transcribe videos
- does not OCR screenshots
- does not create embeddings
- does not maintain vector databases
- does not execute coding agents

All interpretation happens through the user's own local coding agent.

---

## 3.4 Pull, not daemon

There is no required local background service.

When an agent session starts, the plugin checks the project for current state and new intake.

Conceptually:

```text
Agent starts
    ↓
identify current project
    ↓
pull overview
    ↓
triage new inbox items
    ↓
inspect existing work
    ↓
claim work when appropriate
    ↓
execute
```

If no local coding agent is running, new intake simply waits.

The UI says:

**Waiting for local agent**

This is expected behavior, not an error.

---

## 3.5 Cloud operational truth, repository durable ownership

Convex is the authoritative source for live operational state.

The repository contains a durable, human-readable representation of meaningful work.

The repository is **not** a bidirectional database.

V1 rule:

> Cloud → repository export only.

Manual editing of exported Markdown does not mutate cloud state.

This avoids building a distributed synchronization system.

---

# 4. Target user

V1 is primarily for:

- solo developers
- technical founders
- very small engineering teams
- developers running multiple coding-agent sessions
- people using Claude Code, Codex or similar agents as active development workers

The strongest initial user is someone who currently uses Linear/GitHub Issues largely because their agents need persistent work coordination.

---

# 5. Pricing model

## Free

- 1 project
- unlimited work items
- unlimited local agents
- unlimited human collaborators
- reasonable media allowance
- repo export
- web interface
- notifications

The limitation is **projects**, not users or agents.

## Paid

V1 paid differentiation:

- multiple projects
- multiple organizations/workspaces
- larger media allowance
- longer media retention

Future paid capabilities may include cross-project overview and advanced administration.

Do not meter agents or seats.

---

# 6. Core conceptual lifecycle

The human-facing model is:

```text
INBOX
raw human intent
       ↓
READY
agent-understood work
       ↓
WORKING
agent actively executing
       ↓
NEEDS YOU
human judgment required
       ↓
DONE
completed outcome
```

This is not intended to represent a traditional engineering workflow.

It represents the interaction boundary between humans and agents.

---

# 7. Primary screen: Overview

Overview is the core product.

Desktop and mobile web use the same information architecture.

The page contains:

```text
OVERVIEW

┌──────────────────────────────────┐
│ Add something…                   │
│ Bug, idea, screenshot or video   │
│                              + ↑ │
└──────────────────────────────────┘


NEEDS YOU                          2

Authentication migration
Claude needs a decision

Review Safari checkout fix
Ready for approval


WORKING                            3

Fix image upload
Claude Code · 8m

Improve onboarding
Codex · 3m


READY                              7

Handle expired sessions
Fix billing redirect
Compress uploaded images


INBOX                              2

“this gets stuck sometimes”
🎥 screen-recording.mov

“can users delete these?”
🖼 screenshot.png


RECENTLY DONE

✓ Retry failed webhooks
✓ Account switcher
✓ Sidebar overflow
```

Sections with zero items collapse.

No charts.

No metrics.

No burn-down graphs.

No productivity scoring.

---

# 8. Human intake

## 8.1 Capture

A permanent capture control appears at the top of Overview.

Placeholder:

> **Add something…**

Secondary hint:

> Bug, idea, screenshot, video or request

The human can submit:

- text
- image
- multiple images
- video
- file

Future:
- voice recording

The human is not asked for any metadata.

---

## 8.2 Intake object

```typescript
intakes {
  _id
  organizationId
  projectId

  createdByUserId

  text?: string

  status:
    | "new"
    | "claimed"
    | "processed"
    | "dismissed"

  claimedByActorId?
  claimedAt?

  processedAt?

  createdWorkItemIds: Id<"workItems">[]

  createdAt
  updatedAt
}
```

Attachments are stored separately.

---

## 8.3 Triage

Triage is performed by a local agent.

The agent may:

- create one work item
- create multiple work items
- link the intake to an existing work item
- determine that it is a duplicate
- ask the human for clarification
- dismiss it as non-actionable

Example:

Human submits:

> Mobile onboarding is bad here.

plus a video.

Agent examines:

- video
- repository
- current application
- existing work
- project instructions

Agent creates:

**Fix CTA hidden by iOS keyboard**

and potentially:

**Investigate mobile onboarding friction**

The original intake remains linked to both.

---

# 9. WorkItem

A WorkItem is the canonical structured unit of work.

There are not separate database objects for bugs, features and tasks.

```typescript
workItems {
  _id
  organizationId
  projectId

  number
  identifier

  title
  description?

  kind:
    | "task"
    | "bug"
    | "feature"
    | "investigation"
    | "decision"

  state:
    | "ready"
    | "working"
    | "done"
    | "cancelled"

  rank

  createdByActorId

  assignedActorId?

  claimedByActorId?
  claimedAt?
  claimExpiresAt?

  parentId?

  revision

  createdAt
  updatedAt
  completedAt?
}
```

`Needs you` is deliberately **not** a WorkItem state.

---

# 10. Attention

Attention is a first-class concept.

A work item can simultaneously be:

- working
- blocked
- awaiting human decision

Therefore human attention must be represented independently.

```typescript
attentionRequests {
  _id
  organizationId
  projectId
  workItemId

  requestedByActorId
  requestedFromUserId

  kind:
    | "review"
    | "decision"
    | "question"
    | "blocked"

  title
  body?

  urgency:
    | "normal"
    | "important"

  status:
    | "open"
    | "seen"
    | "resolved"

  createdAt
  seenAt?
  resolvedAt?
}
```

Any open AttentionRequest causes the WorkItem to appear under **Needs you**.

---

# 11. Notification system

Agents do not directly choose delivery channels.

Agents request attention.

The SaaS decides delivery.

## Normal product events

Examples:

- agent starts work
- work item created
- item completed
- comment created
- item triaged

These appear in the UI only.

No push.

No email.

## Needs human

Examples:

- decision required
- question required
- review requested
- agent blocked

Delivery:

1. native push immediately
2. appears under Needs you
3. if marked important and still unresolved after 60 minutes, send email

V1 does not provide elaborate notification rules.

---

# 12. Claiming and concurrency

Multiple agents must not accidentally execute the same WorkItem.

Agents therefore **claim**, rather than merely become assigned.

Claiming is atomic.

```typescript
claim {
  actorId
  claimedAt
  expiresAt
}
```

Default lease:

**30 minutes**

Agents performing long work renew the lease through meaningful update calls.

If the claim expires, the work may be reclaimed.

Assignment and claim are separate concepts.

Assignment means:

> This work is intended for this actor.

Claim means:

> This actor currently owns execution rights.

V1 may omit manual assignment UI entirely.

---

# 13. Runs

A Run represents an execution attempt.

```typescript
runs {
  _id
  organizationId
  projectId
  workItemId

  actorId

  status:
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "cancelled"

  summary?

  externalSessionId?

  startedAt
  finishedAt?
}
```

One WorkItem may have multiple runs.

The human generally does not manage Runs directly.

They are useful for:

- showing which agent is currently working
- session history
- failures
- execution duration
- correlating outputs

---

# 14. Actor model

Humans and agents are both Actors.

```typescript
actors {
  _id
  organizationId

  type:
    | "human"
    | "agent"
    | "system"

  name
  avatarUrl?

  userId?          // humans

  agentType?       // claude-code, codex, etc.
  instanceId?      // optional current instance identity

  createdAt
  lastSeenAt?
}
```

Agents are never represented as fake human users.

---

# 15. Authentication

No Clerk.

Human login supports:

### Google OAuth

and:

### Email one-time code

No passwords.

Better Auth handles authentication mechanics.

Better Auth runs against Convex using the maintained Convex integration. citeturn677204search1

Application tenancy remains our own domain model.

---

# 16. Organizations and memberships

```typescript
organizations {
  _id
  name
  slug

  createdByUserId

  createdAt
}
```

```typescript
memberships {
  _id
  organizationId
  userId

  role:
    | "owner"
    | "member"

  createdAt
}
```

No custom role system in V1.

No complex permissions.

Owner can:

- manage organization
- add/remove members
- manage project credentials
- manage billing

Member can:

- use projects
- create intake
- comment
- review
- resolve attention

---

# 17. Projects

A project corresponds conceptually to a repository/codebase.

```typescript
projects {
  _id
  organizationId

  name
  slug

  repositoryUrl?

  createdAt
  archivedAt?
}
```

Free users get one active project.

---

# 18. Agent authentication

Agents do not use human authentication.

Each project receives install credentials.

V1 uses **project-scoped API tokens**.

The local plugin stores the token in local environment/configuration and never commits it.

Server stores only a secure hash.

```typescript
agentCredentials {
  _id
  organizationId
  projectId

  name

  tokenHash

  createdAt
  lastUsedAt?
  revokedAt?
}
```

A coding session may identify itself during calls:

```json
{
  "agent": "claude-code",
  "instance": "rene-macmini-42"
}
```

The project credential authenticates access.

The instance identity provides human-readable activity attribution.

This avoids generating an API credential for every temporary agent session.

---

# 19. Agent API

The API must be deliberately small.

V1 agent-facing operations:

```text
get_overview
get_intake
claim_intake
complete_triage

create_work
get_work
start_work
update_work
finish_work

add_comment

request_attention
resolve_attention

get_attachment
```

Avoid exposing raw database CRUD.

High-level operations encode desired behavior.

---

# 20. Agent startup protocol

The official plugin instructs agents to perform this sequence at session initialization:

```text
1. Determine repository/project.

2. Fetch project overview.

3. Check for open attention that contains
   a human response relevant to prior work.

4. Check for WorkItems already claimed
   by this agent/session.

5. Pull new Inbox items.

6. Triage unprocessed Inbox.

7. If previous work exists, continue it.

8. Otherwise inspect Ready work.

9. In manual mode:
      tell the human what is available.

10. In autonomous mode:
      claim highest-ranked appropriate item
      and begin.
```

Default V1 mode:

**manual execution**

The plugin may automatically triage Inbox, but does not automatically start arbitrary Ready work without human instruction.

Configuration may enable autonomous mode.

---

# 21. Agent triage rules

The official plugin should instruct the agent:

- inspect repository context before creating work
- search existing work for duplicates
- keep WorkItems independently actionable
- split unrelated work
- merge duplicate intake
- avoid creating speculative work
- create acceptance criteria where useful
- request human clarification only when ambiguity materially changes implementation

The SaaS itself does not enforce semantic quality.

The plugin provides the behavior.

---

# 22. Comments

Humans and agents can comment.

```typescript
comments {
  _id
  organizationId
  workItemId

  actorId

  body

  createdAt
}
```

Comments form the primary conversational history of a WorkItem.

V1 does not support:

- nested comment threads
- reactions
- rich formatting beyond simple Markdown
- @mentions beyond future consideration

---

# 23. Artifacts

Outputs produced by work can be attached to a WorkItem.

```typescript
artifacts {
  _id
  organizationId
  projectId
  workItemId
  runId?

  actorId

  type:
    | "commit"
    | "pull_request"
    | "deployment"
    | "url"
    | "image"
    | "file"
    | "report"

  title
  url?
  metadata?

  createdAt
}
```

GitHub remains responsible for code, diffs, PRs and CI.

The tracker merely references them.

---

# 24. Events

Every meaningful change generates an immutable event.

```typescript
events {
  _id
  organizationId
  projectId
  workItemId?
  runId?

  actorId

  type
  data

  createdAt
}
```

Examples:

```text
intake.created
intake.claimed
intake.processed

work.created
work.claimed
work.started
work.updated
work.completed

attention.requested
attention.resolved

comment.created

run.started
run.completed
run.failed

artifact.created
```

The system is **not fully event-sourced**.

Current objects remain authoritative.

Events provide history and observability.

---

# 25. Optimistic concurrency

Every mutable WorkItem has:

```typescript
revision: number
```

Agent mutations may provide an expected revision.

If another actor changed the object first, mutation fails with conflict and the agent must fetch current state.

This prevents concurrent agents from silently overwriting one another.

---

# 26. Idempotency

Agent mutations support an idempotency key.

This is mandatory for create/start/finish-style operations.

Retries must not create:

- duplicate work
- duplicate comments
- duplicate runs
- duplicate attention requests

---

# 27. Media storage

Cloudflare R2 stores:

- screenshots
- video
- files

Convex stores attachment metadata.

```typescript
attachments {
  _id
  organizationId
  projectId
  intakeId?

  createdByUserId

  filename
  mimeType
  byteSize

  storageKey

  createdAt
  expiresAt?
}
```

Default V1 limits:

### Free
- 1 GB active media storage
- maximum individual upload: 250 MB

### Paid
- 20 GB included initially

Textual work history is not deleted based on these limits.

Media quotas can evolve after observing usage.

Do not design a complex storage billing system for V1.

---

# 28. Repository ownership/export

The official plugin creates:

```text
.agent-work/
```

Suggested structure:

```text
.agent-work/
  project.json
  work/
    143-fix-safari-login.md
    144-compress-images.md
```

A completed or materially updated WorkItem can be exported into Markdown.

Example:

```markdown
---
id: PROJ-143
title: Fix Safari login
status: done
created: 2026-08-30
completed: 2026-08-30
---

# Goal

Safari login can remain stuck after OAuth callback.

# Outcome

Updated callback handling and session state reset.

# Source intake

User reported login failure on mobile Safari.

# Artifacts

- PR #331
- commit 7fd31ab
- preview deployment

# Notes

Regression coverage added for callback failure.
```

The export is designed to be:

- readable
- Git-friendly
- agent-readable
- vendor-independent

---

# 29. Export behavior

Export happens at meaningful lifecycle points:

- WorkItem created after triage
- review requested
- WorkItem completed
- explicit local sync

Do **not** create Git changes for:

- heartbeats
- every comment
- every status mutation
- attention notification delivery
- presence events

The repository should contain signal, not operational noise.

---

# 30. Source-of-truth rule

V1 rule:

> Convex owns live WorkItem state.

`.agent-work` is an export.

Editing an exported Markdown file does not automatically update Convex.

Future versions may introduce an explicit import command, but there is no automatic bidirectional synchronization.

---

# 31. Work ordering

No priority labels in the primary UI.

Ready work has a sortable `rank`.

Humans can drag/reorder Ready items.

Agents treat the highest-ranked suitable item as next.

Internally there may eventually be priority metadata, but V1 does not expose:

- urgent
- high
- medium
- low

Humans express priority by ordering.

---

# 32. Blocked work

`blocked` is not a lifecycle state.

A WorkItem remains `working` or `ready` and may carry a blocking condition.

If human intervention is necessary, an AttentionRequest is created.

This prevents states from multiplying.

---

# 33. Work item detail UI

Opening an item should not navigate away from Overview unnecessarily.

Desktop:

**side panel**

Mobile web:

**full-screen sheet**

Example:

```text
Fix Safari authentication
PROJ-143

Claude Code · working

────────────────────

Goal

Safari OAuth callbacks occasionally
leave the user unauthenticated.

────────────────────

Latest

Claude:
I found the callback race and added
coverage for it.

Files
middleware.ts
auth.ts

PR →
Preview →

────────────────────

René:
Also test a fresh account.

Claude:
Will do.

────────────────────

[ Add comment… ]
```

When attention exists:

```text
Claude needs a decision

Migrate existing accounts?

[ Respond ]
```

---

# 34. Recently Done

Done is intentionally not an archive browser on Overview.

Show approximately:

**latest 10–20 completed items**

with an option:

> View all

The main Overview should stay compact.

---

# 35. Search

V1 includes simple text search across:

- WorkItem title
- WorkItem description
- comments
- Intake text

Search is secondary and can appear through a keyboard shortcut/search control.

No semantic/AI search.

---

# 36. Native applications

Web ships first.

Later:

### iOS
Swift + SwiftUI

### Android
Kotlin + Jetpack Compose

The native applications use the same Convex/backend model.

Native V1 functionality:

- authentication
- Overview
- capture Intake
- upload media
- WorkItem detail
- comments
- resolve Attention
- push notifications

Native apps do not initially include:

- agent credential management
- organization settings
- billing
- project creation
- repo installation
- plugin setup

Those remain web/admin functions.

---

# 37. Push notifications

Native applications register device push tokens.

```typescript
devices {
  _id
  userId

  platform:
    | "ios"
    | "android"

  pushToken

  enabled

  createdAt
  lastSeenAt
}
```

Push payload includes:

```text
attentionRequestId
workItemId
projectId
```

Tapping a push deep-links directly to the relevant WorkItem.

---

# 38. Email notifications

Transactional email provider:

**Resend**

Email is fallback/escalation, not the primary notification channel.

For important unresolved Attention:

```text
T+0
push

T+60 minutes
email if unresolved
```

No email digests in V1.

No status-change emails.

---

# 39. Web technology

### Frontend
- TypeScript
- SolidJS
- SolidStart

### Hosting/runtime
- Cloudflare Workers
- Cloudflare deployment through the current SolidStart/Cloudflare Vite path citeturn677204search2

### Application state/backend
- Convex

### Authentication
- Better Auth
- Google OAuth
- email OTP
- Better Auth Convex integration citeturn677204search1

### Media
- Cloudflare R2

### Email
- Resend

### Native
- SwiftUI
- Jetpack Compose

---

# 40. Web performance philosophy

The authenticated application should behave more like a native control surface than a website.

After initial application load:

- Convex subscriptions update state reactively
- mutations use optimistic UI where safe
- item detail uses overlays/sheets rather than page reloads
- navigation preserves Overview position
- no loading spinner for ordinary mutations
- capture appears locally immediately
- status changes appear immediately
- server confirmation happens in background

Target:

> Ordinary interaction should feel instantaneous.

---

# 41. Tenant isolation

Every business object carries:

```text
organizationId
```

and where relevant:

```text
projectId
```

Do not rely on inferring tenancy only through relational lookups.

All Convex server functions validate organization/project membership.

Client-side visibility is never treated as authorization.

---

# 42. Suggested Convex tables

V1:

```text
organizations
memberships
projects

actors

intakes
attachments

workItems
runs

attentionRequests
comments
artifacts
events

agentCredentials
idempotencyKeys

devices
notificationDeliveries
```

Approximately 16 focused tables.

This is still intentionally small.

---

# 43. Useful indexes

Examples:

```text
workItems
  by_org_project_state
  by_project_rank
  by_project_claim

intakes
  by_project_status_created

attentionRequests
  by_user_status_created
  by_work_status

events
  by_project_created
  by_work_created

runs
  by_work_started
  by_actor_status

comments
  by_work_created
```

Every hot query should be explicitly indexed.

---

# 44. Overview query model

The Overview should be obtainable from a small number of reactive queries.

Conceptually:

```typescript
overview {
  attention: AttentionItem[]
  working: WorkItem[]
  ready: WorkItem[]
  inbox: Intake[]
  recentlyDone: WorkItem[]
}
```

Do not make the client independently assemble dozens of low-level queries if one coherent server query performs better.

---

# 45. Installation/plugin experience

The goal:

> Tell the coding agent to install the tracker.

The official installation package should support at least:

- Claude Code
- Codex
- generic `AGENTS.md`

MCP may be provided as an additional transport.

The plugin/setup process should:

1. detect repository root
2. authenticate user if necessary
3. create/select project
4. issue project credential
5. store credential locally
6. create `.agent-work/`
7. install agent instructions/tools
8. add appropriate ignore rules for secrets
9. perform first sync
10. verify connection

A human should not need to manually construct API calls.

---

# 46. Manual vs autonomous execution

Project configuration:

```text
Agent execution mode

○ Manual
  Agent triages and suggests next work,
  but waits before starting.

○ Autonomous
  Agent may claim and begin Ready work.
```

Default:

**Manual**

Inbox triage may still happen automatically when an agent session starts.

---

# 47. What the product does NOT do

V1 explicitly excludes:

- hosted AI
- hosted coding agents
- background local daemon
- autonomous cloud execution
- GitHub replacement
- pull-request diff review
- CI system
- roadmaps
- sprints
- cycles
- story points
- estimates
- time tracking
- velocity
- analytics dashboards
- custom workflows
- custom issue fields
- complex labels
- per-seat billing
- complex permission systems
- bidirectional Git synchronization
- Slack integration
- Linear synchronization
- semantic search
- agent model selection
- prompt management

---

# 48. Linear migration

Not V1 launch-blocking.

Design data model so future migration is straightforward.

Future importer:

```text
Connect Linear
    ↓
choose project
    ↓
import open issues
    ↓
optionally import recently completed
```

It is an import, not permanent two-way synchronization.

---

# 49. Security requirements

V1 must include:

- hashed agent credentials
- credentials visible only once at creation
- credential revocation
- project-scoped agent access
- organization validation on every server operation
- signed/temporary media access
- upload MIME and size validation
- rate limiting for public/auth endpoints
- OTP attempt limiting
- OAuth state/PKCE handled by auth library
- no secrets stored in repository
- audit Events for credential creation/revocation
- idempotent agent mutations

---

# 50. Success criteria for V1

The product succeeds if a user can:

### Setup
1. sign in
2. create a project
3. tell Claude Code/Codex to install the plugin
4. begin using the system without manually learning its API

### Human intake
1. open Overview
2. type “checkout gets stuck here”
3. attach a screen recording
4. submit in seconds

### Local triage
1. start Claude Code later
2. agent notices the Intake
3. agent inspects repository
4. agent converts it into useful structured work

### Execution
1. agent claims work
2. Overview shows Working immediately
3. human can see what is happening

### Human intervention
1. agent requests a decision
2. WorkItem appears under Needs you
3. push notification reaches human
4. human responds from phone/web
5. local agent sees response on next pull

### Completion
1. work moves to Done
2. outcome and artifacts are visible
3. durable Markdown representation exists in repo

If those flows feel excellent, V1 is successful.

---

# 51. Product statement

The shortest accurate description is:

> **A shared work queue for humans and coding agents.**

More differentiated:

> **See what your coding agents are doing, give them work, and answer when they need you.**

And the deeper product philosophy:

> **Humans provide intent and judgment. Agents provide structure and execution.**

The product exists to make that relationship visible, persistent and manageable without forcing either side through a traditional project-management system.
