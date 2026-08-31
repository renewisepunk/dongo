<!-- dongo-managed:v1 -->
---
id: "DONGO-5"
title: "Claude MCP human Attention lifecycle verification"
status: "ready"
created: 2026-08-31
---

# Goal

Prove Claude Code actor attribution, replay-safe work mutations, and a normal human Attention response on the development stack.

# Notes

Claude Code: ## Progress update

Started this WorkItem under a single stable dongo session (`claude-code-dongo-5-validation`) as Claude Code. Recorded the planned approach on the item, and am validating that each mutation (`update_work`, `start_work`, `add_comment`, `request_attention`) is replay-safe by repeating it once with the same idempotency key before proceeding.

Next: request normal human Attention for approval to continue or changes, then stop and wait.
