# Claude Code onboarding acceptance matrix — 2026-09-05

This matrix is the release contract for Claude Code onboarding. It joins the
agent-side state-first instructions, CLI repository binding, browser approval,
managed `CLAUDE.md` integration, host authorization, and the final
`dongo_session_start` verification without treating them as one opaque login.

| Starting state | Required behavior | Automated evidence |
| --- | --- | --- |
| CLI absent | Install the exact scoped package, then verify its version. | Public-guide browser journey and dongo-onboarding skill validation. |
| CLI current | Preserve the installation and move immediately to authorization and repository checks. | Public-guide browser journey. |
| CLI outdated | Explain the installed/current version gap and obtain explicit approval before upgrading. | Public-guide browser journey and dongo-onboarding skill validation. |
| Repository unbound | Start one browser approval, bind the exact repository/project, then run doctor. | `packages/cli-core/test/service.test.ts` and device-authorization browser journeys. |
| Repository already bound | Reuse the healthy grant without another browser request. | `packages/cli-core/test/service.test.ts`. |
| Legitimate linked worktree | Reconcile the exact sibling binding without reconnecting; reject unrelated clones and changed remotes. | `packages/cli-core/test/service.test.ts`. |
| Browser uses another valid dongo account | Reuse that browser session, expose the projects owned by that identity, and support its first-project path without a generic login retry. | `apps/web/e2e/specs/claude-onboarding.spec.ts`. |
| Browser approval completed | Keep the grant pending until Claude Code verifies the project-scoped session. | `apps/web/e2e/specs/claude-onboarding.spec.ts`. |
| Claude Code grant expired or revoked | Repair only the host grant and preserve the healthy CLI/repository phases. | `apps/web/e2e/specs/claude-onboarding.spec.ts`. |
| Claude Code configuration absent or stale | Preview, apply, and safely replace only the managed project entry while preserving unrelated configuration and prose. | `packages/cli-core/test/integrations.test.ts`. |
| Setup resumes after interruption | Re-run read-only checks, observe an existing connection attempt, and never create a duplicate authorization. | `packages/cli-core/test/service.test.ts` and the dongo-onboarding phase ledger. |
| First project versus additional repository | Present the correct create-and-bind path for each without sending a valid account back to sign-in. | `apps/web/e2e/specs/claude-onboarding.spec.ts` and `device-authorization.spec.ts`. |
| Host reports connected | Require `dongo_session_start` to identify the intended project and Claude Code installation before setup is complete. | `apps/web/e2e/specs/claude-onboarding.spec.ts` and MCP contract tests. |

The acceptance fixtures use synthetic identities and opaque placeholder codes.
They never retain access tokens, refresh tokens, approval URLs, or signed
attachment URLs. CLI and Claude Code credentials remain independently issued,
stored, refreshed, and revoked.
