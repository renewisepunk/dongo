# Execution waves

This schedule assumes four available agent slots: Agent 00 plus three active builders. Agents are activated only when their dependencies are ready. Full product UI is intentionally behind the agent protocol gate.

## Wave 0 — protocol, auth, and runtime feasibility

Parallel builders: Agents 01, 02, and 10. Coordinator: Agent 00.

- Agent 01 pins the workspace, Convex, Better Auth, Better Auth Convex integration, Better Auth MCP/device packages, MCP TypeScript SDK v2, Codex, and Claude candidate versions. It creates the transport-neutral operation contract and fake transport.
- Agent 02 proves human Google/email authentication, authenticated Convex identity, OAuth consent/project selection, CLI Device Authorization, token refresh, logout, and revocation in local and preview environments.
- Agent 10 proves modern stateless remote Streamable HTTP MCP discovery/routing and OAuth, then tests the exact Codex, Claude, and generic MCP clients. It enables the SDK's legacy era only if one of those pinned clients requires it, and calls one read fixture and one idempotent write fixture through every admitted era.
- Agent 00 decides whether the OAuth provider can share the human Better Auth instance. If the current Convex integration collision reproduces, Agent 00 selects the isolated authorization-server boundary described by D-16; no agent substitutes pairing or custom OAuth.
- Agent 00/01 provision the development Worker environment on `dev.dongo.so`, bind it only to Convex `wandering-camel-662` and development resources, and leave the existing `dongo.so` deployment untouched.

Exit gate:

- `/api/auth/convex/token` or its pinned equivalent continues to authenticate Convex after all proposed OAuth/MCP/device plugins are present;
- the CLI completes terminal → browser approval → authenticated terminal without code copy/paste and also works when the browser must be opened elsewhere;
- Protected Resource Metadata, authorization-server metadata, PKCE, issuer/audience validation, refresh rotation, revocation, CIMD, and the required DCR fallback pass;
- `server/discover`, per-request protocol metadata, required method/tool routing headers, stateless horizontal handling, and any admitted legacy negotiation pass;
- Codex and Claude can authenticate and call the same fixture tools;
- every package and supported client version is pinned;
- `dev.dongo.so` serves the preview stack with valid TLS and cannot read production cookies, tokens, grants, storage, or Convex data;
- the selected auth topology and fallback are recorded before Contract v1-alpha.1 is approved.

This is a hard gate. Do not begin domain breadth or full UI when the auth topology is unresolved.

## Wave 1 — contracts, domain core, and adversarial harness

Parallel builders: Agents 03, 02, and 07. Coordinator: Agent 00. Agent 01 services shared-file changes at the checkpoint.

- Agent 03 implements schema fragments, server-derived principals, Events, idempotency, Intake/Work/Run/Attention/Comment invariants, and internal operation handlers.
- Agent 02 implements organizations, memberships, project selection, installation Actors, OAuth grant metadata/revocation, and the minimal auth/consent/revoke web surfaces.
- Agent 07 converts the operation registry, OAuth state model, lifecycle matrix, and fixtures into contract, authorization, protocol, concurrency, and failure-injection tests.
- Agent 01 composes schema/routes/configuration and publishes Contract v1-alpha.2 once at the checkpoint.

Exit gate:

- domain tests pass against pure/internal operations;
- every grant resolves server-side to one project and one installation Actor;
- tenant, scope, archived-project, removed-membership, revoked-grant, and forged-identity tests fail closed;
- fake HTTPS and MCP adapters produce equivalent results from the same fixtures;
- no unresolved decision changes public operation schemas or installation identity.

## Wave 2 — CLI and MCP first-class surfaces

Parallel builders: Agents 03, 06, and 10. Coordinator: Agent 00.

- Agent 03 exposes the typed `/api/agent/v1` adapter and trusted gateway-to-Convex request context over the shared operation handlers.
- Agent 06 builds the typed client, `dongo connect`, secure credential storage, core human/JSON commands, repository detection, doctor, and deterministic Markdown export.
- Agent 10 builds the OAuth-protected remote Streamable HTTP server, stable tool registry, bounded results, tool annotations, server instructions, and non-secret Codex/Claude/generic configurations.
- Agent 02 fixes authorization integration defects only in owned paths.
- Agent 07 runs the client/protocol compatibility matrix at the checkpoint.

Surface gate:

1. CLI Device Authorization succeeds, refreshes, logs out, and is revoked server-side.
2. Codex authenticates with `codex mcp login dongo` and calls `dongo_session_start`.
3. Claude authenticates with `claude mcp login dongo` or `/mcp` and calls the same tool.
4. A generic MCP inspector discovers authorization and calls the same read tool.
5. CLI, Codex MCP, and Claude MCP each perform one idempotent mutation and receive the same domain result/error semantics.
6. Revoking one installation does not revoke or reveal another installation's token family.
7. No repository or host configuration contains a credential.

Do not begin the full product UI until this gate passes on the staging stack.

## Wave 3 — minimal human loop and agent walking skeleton

Parallel builders: Agents 04, 06, and 10. Agent 03 services contract-approved backend defects. Coordinator: Agent 00.

- Agent 04 connects only the minimal text Intake, minimal project status, and human Attention response surfaces to the live contracts. Full Overview/detail polish remains fixture-only.
- Agent 06 completes CLI lifecycle commands, local snapshot/export signals, failure recovery, and installation/doctor workflows.
- Agent 10 completes the full V1 MCP tool surface, host configuration installers/manifests, workflow instructions, attachment metadata handling, and protocol error mapping.
- Agent 07 runs the same golden flow through the CLI, Codex MCP, and Claude MCP.

Agent walking-skeleton gate:

1. New user signs in and creates/selects a project.
2. `dongo connect` opens one complete browser link; approval returns an authenticated terminal.
3. Codex and Claude connect to the remote MCP server with independent OAuth grants.
4. Human submits text Intake.
5. Each agent surface can pull, claim, and complete triage against its isolated fixture/project run.
6. Work appears in the minimal status view.
7. Agent claims and starts work; activity is truthful.
8. Agent requests Attention; the human responds in the minimal web UI.
9. The response is visible on the next explicit pull.
10. Agent finishes the WorkItem.
11. CLI writes deterministic `.agent-work` Markdown from `sync_snapshot`; remote MCP never claims a local write.

Run the scenario once per supported surface and repeat it with a deliberately lost/retried mutation response. Safety invariants must score 100% before breadth begins.

## Wave 4 — full web product, media, and hardening

Parallel builders: Agents 04, 05, and 07.

- Agent 04 completes the full reactive Overview, route-backed Work detail, media capture states, ordering, search, Recently Done, artifacts, member/project/installation settings, and responsive/accessibility hardening.
- Agent 05 implements direct/multipart R2 uploads, secure downloads, quotas, retention state, Resend delivery, notification scheduling, and delivery records.
- Agent 07 expands E2E, prompt-injection, media, OAuth, MCP, browser, accessibility, and performance coverage.
- Agents 02, 03, 06, and 10 are recalled only for defects in owned paths or additive changes through the contract process.

Web Beta gate:

- all PRD web flows work on staging;
- CLI, Codex, Claude, and generic MCP tests remain green without host-specific domain behavior;
- two agents cannot execute the same WorkItem;
- 250 MB upload follows the direct/multipart path and recovers from interruption;
- revoked grants and static CI credentials fail immediately;
- accessibility, browser, responsive, performance, OAuth, and MCP budgets pass.

## Wave 5 — native clients in parallel

Parallel builders: Agents 08, 09, and 07.

- Agent 08 implements the SwiftUI client and APNs.
- Agent 09 implements the Compose client and FCM.
- Agent 07 owns mobile contract tests, notification delivery tests, security review, staging journeys, and release rehearsal.
- Existing owners are recalled only for defects in their paths.

Exit gate:

- both clients consume the frozen human API without platform-specific backend behavior;
- authentication, Overview, Intake/media, Work detail, comments, Attention response, and deep-linked push work;
- secret/device-token handling and revocation are verified;
- offline/reconnect behavior is honest and recoverable.

## Wave 6 — monetization, hardening, and V1 release

Parallel builders: Agents 02, 05, and 07.

- Agent 02 implements organization-level entitlements and the chosen billing boundary.
- Agent 05 hardens quota enforcement, notification retries, retention cleanup, and delivery observability.
- Agent 07 runs tenant isolation, OAuth/MCP and concurrency stress, clean-machine installs, native push, rollback, canary, and support-runbook gates.
- Agent 00 controls release order and accepts only immutable, previously tested artifacts.

V1 ships only when `03-release-gates.md` passes on the exact release candidates.

## Critical dependency graph

```text
runtime/auth/MCP feasibility
  -> transport-neutral contracts + fixtures
      -> installation identity + grant model
      -> domain operations
      -> protocol/security harness
          -> typed HTTPS adapter -> CLI + local export
          -> remote MCP adapter -> Codex / Claude / generic MCP
              -> agent protocol gate
                  -> minimal human loop
                      -> full web + media
                          -> native clients
all paths
  -> cross-feature/security tests
      -> canary
          -> V1
```

## Integration checkpoint procedure

At the end of every wave:

1. Freeze new work.
2. Each agent submits its handoff report.
3. Agent 00 verifies ownership boundaries and merges in dependency order.
4. Agent 01 regenerates contracts, clients, schema, and lockfiles once.
5. Agent 07 runs contract, OAuth, MCP, build, state, and smoke gates.
6. Failed work returns to the owning agent; other agents do not patch across boundaries.
7. Agent 00 tags the accepted contract/fixture and supported-client matrix used by the next wave.
