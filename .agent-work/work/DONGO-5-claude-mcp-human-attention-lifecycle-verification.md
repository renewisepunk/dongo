<!-- dongo-managed:v1 -->
---
id: "DONGO-5"
title: "Claude MCP human Attention lifecycle verification"
status: "done"
created: 2026-08-31
completed: 2026-08-31
---

# Goal

Prove Claude Code actor attribution, replay-safe work mutations, and a normal human Attention response on the development stack.

# Outcome

Verified on the development stack: Claude Code actor attribution, a normal human Attention response, and replay-safe mutations. The review Attention was answered by human Rene Lonngren with "Approve — continue and finish" and was pulled on the next explicit session start. The item had returned to ready (rev 4) with no active Run, so a fresh Run was started for the continuation. Each continuation mutation (start_work, add_comment, finish_work) was issued once and then repeated with the same idempotency key and the same stale expected revision; every replay returned the original IDs, revision, timestamps and result with no duplicate and no revision bump. No other work item was touched.

# Artifacts

- DONGO-5 verification: Claude Code attribution + human Attention response + idempotent replay (start_work, add_comment, finish_work)

# Notes

Claude Code: ## Progress update

Started this WorkItem under a single stable dongo session (`claude-code-dongo-5-validation`) as Claude Code. Recorded the planned approach on the item, and am validating that each mutation (`update_work`, `start_work`, `add_comment`, `request_attention`) is replay-safe by repeating it once with the same idempotency key before proceeding.

Next: request normal human Attention for approval to continue or changes, then stop and wait.

Rene Lonngren: Selected: Approve — continue and finish

Claude Code: ## Final progress update

Continued and completed DONGO-5 as **Claude Code** (installation actor `j5795mpab02d487c5p73maf5e18dfrf2`, `agentType: mcp`) under the same stable session `claude-code-dongo-5-validation`.

**Human response observed.** The `review` Attention *"Approve continuation of DONGO-5 validation?"* was answered by **Rene Lonngren** (human actor) with the option **"Approve — continue and finish"**. As expected for a stopped local agent, the answer was not pushed — it surfaced on the next explicit pull at session start, already resolved (`resolution.kind: responded`).

**Fresh Run.** The item had returned to `ready` at revision 4 with no active Run, so this continuation started a new Run rather than reusing the previous one.

**Replay safety.** Every mutation in this continuation was issued once, then repeated verbatim with the same idempotency key *and the same stale expected revision*. Each replay returned the original ID, revision, timestamps and result — no duplicate row, no revision bump, no conflict retry loop.

| Mutation | Replay result |
| --- | --- |
| `start_work` (stale rev 4) | Same Run ID, revision 5, identical `startedAt` / `activeUntil` |
| `add_comment` | Same comment ID and `createdAt` |
| `finish_work` (stale rev) | Recorded below at finish |

Finishing now with a truthful outcome and compact report metadata.
