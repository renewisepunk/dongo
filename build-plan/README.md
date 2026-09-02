# dongo build plan

Status: implementation-ready. Product implementation must follow the design handoff below; the original PRD remains unchanged.

This folder turns [`../dongo-prd.md`](../dongo-prd.md) into an executable, multi-agent delivery plan without changing the original PRD.

Baseline PRD SHA-256 recorded when this plan was created:

```text
b6a97c39aaf056dd6380e451b89fd76ff8883ac968ede5a1b0fab48eceb0f70a
```

## Recommended delivery strategy

Build agent-first: freeze one transport-neutral operation contract, prove both official agent surfaces, and only then expand the human product UI. The first walking skeleton is:

```text
human signs in through the minimal web auth surface
  -> creates or selects a project
  -> runs `dongo connect`
  -> follows one browser link and returns to an authenticated terminal
  -> connects the remote dongo MCP server in Codex and Claude
  -> submits text intake through the minimal web surface
  -> CLI, Codex MCP, and Claude MCP each pull and triage the same fixture flow
  -> work appears in Overview
  -> agent claims and starts work
  -> agent requests attention
  -> human responds
  -> agent finishes work
  -> deterministic Markdown export is written
```

This proves the differentiated product loop and the interoperability boundary before investing in the full dashboard. Before the agent gate, web work is limited to authentication, project selection, OAuth/device approval, installation revocation, text Intake, a minimal status view, and human Attention response. Media, the full Overview/detail experience, rich search, notifications, billing, and native clients follow after the CLI and MCP paths are reliable.

The canonical contract is the versioned operation registry and its domain semantics—not REST, CLI, or MCP. The CLI uses the typed HTTPS adapter. The remote Streamable HTTP MCP server maps tools to the same operations. Neither surface shells out to the other, and no host gets a private behavior fork.

The implementation pod is designed for four concurrent slots:

- one integration lead remains active throughout;
- up to three implementation agents work in parallel;
- agents own disjoint paths;
- shared contracts are frozen before dependent work starts;
- integration happens after every wave, not at the end of the project.

## Read order

1. [`00-working-decisions.md`](00-working-decisions.md) — decisions that must be accepted or changed before code.
2. [`01-architecture-and-contracts.md`](01-architecture-and-contracts.md) — proposed repository shape and service boundaries.
3. [`02-execution-waves.md`](02-execution-waves.md) — dependency graph, parallel schedule, and checkpoints.
4. [`03-release-gates.md`](03-release-gates.md) — definitions of done from walking skeleton through V1.
5. [`04-user-journey.md`](04-user-journey.md) — human, terminal, and MCP-host journeys screen by screen.
6. [`05-agent-first-cli-mcp.md`](05-agent-first-cli-mcp.md) — researched agent-first architecture, authentication flows, MCP surface, and compatibility matrix.
7. [`06-design-implementation-contract.md`](06-design-implementation-contract.md) — the visual source of truth, responsive behavior, and the approved device-auth adaptation.
8. [`07-cli-credential-storage.md`](07-cli-credential-storage.md) — the accepted npm CLI credential architecture, precedent research, threat model, lifecycle, migration, and release gates.
9. [`08-local-runner.md`](08-local-runner.md) — the accepted outbound local-runner contract for Codex and Claude Code, including trust, lifecycle, adapters, and release gates.
10. [`agents/`](agents/) — the mission, ownership, tasks, and acceptance criteria for each agent.

## Agent roster

| Agent | Mission | Primary ownership |
|---|---|---|
| 00 | Integration lead | decisions, shared interfaces, merge gates |
| 01 | Platform and contracts | workspace, environments, versioned contracts, shared UI foundations |
| 02 | Identity and tenancy | Better Auth, organizations, projects, OAuth grants/installations, service credentials, entitlements |
| 03 | Core backend | Convex domain model, lifecycle invariants, shared operations, HTTPS adapter, search |
| 04 | Web product | full SolidStart product UX after the agent protocol gate |
| 05 | Media and notifications | R2 uploads/downloads, quotas, email, push delivery pipeline |
| 06 | CLI and local integration | shared client, one-link device auth, CLI, local configuration, repo export |
| 07 | Quality, security, and release | contract/MCP/E2E/security tests, observability, CI, release and rollback |
| 08 | iOS | SwiftUI native client and APNs |
| 09 | Android | Compose native client and FCM |
| 10 | MCP gateway and host integrations | remote Streamable HTTP MCP, OAuth resource server, tools, Codex/Claude/generic setup |

## Multi-agent operating rules

- Use a separate Git worktree and branch per active implementation agent once the repository is initialized.
- Only the named owner edits a path. Cross-owner changes are requested through Agent 00.
- Only Agent 01 edits root manifests, lockfiles, generated-code configuration, or shared framework configuration.
- Generated Convex/Auth clients are never edited manually.
- Every feature agent owns its co-located unit tests. Agent 07 owns cross-feature, security, and release tests.
- Every task begins from a named contract version and fixture set.
- Every handoff reports touched paths, commands run, acceptance evidence, risks, and follow-up requests.
- Schema and API changes remain additive until every supported client has migrated.
- No agent may silently reinterpret an unresolved decision in `00-working-decisions.md`.

## What is deliberately deferred

- Full product UI breadth until the CLI and authenticated remote MCP golden paths pass.
- Optional local stdio MCP compatibility shim until the remote Streamable HTTP server is stable.
- Host-specific workflow logic beyond configuration, installation guidance, and tested capability differences.
- Bidirectional repository synchronization.
- Linear migration.
- Advanced billing, analytics, workflow customization, and administration.
- Native implementation until the web/agent API is frozen and the walking skeleton passes.
