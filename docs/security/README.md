# dongo security overview

Last reviewed: 2026-09-01  
Applies to: the production dongo service

## The short version

dongo coordinates work between people and coding agents. Connecting dongo does not give the service general access to your repository, shell, Git history, local environment, or developer accounts.

Your local agent keeps the permissions granted by its host. Only the work and files that a person or authorized agent adds to an approved dongo project become dongo project data.

## Security principles

- **Repository content stays local by default.** dongo does not automatically browse, mirror, or scan your source tree.
- **Connections are project-scoped.** A person approves an agent for a specific project rather than the entire account.
- **Agents use their own identity.** Agent activity is attributed to the installation that performed it.
- **Access is revocable.** An installation can be disconnected when it should no longer access a project.
- **Sharing is intentional.** Work records and explicitly attached files cross the boundary; local development data does not cross automatically.

## Parallel execution boundary

dongo may coordinate several active Runs only after a project owner enables
parallel work. The configured 2–8 concurrent-Run value is a safety cap, not a
paid-plan entitlement; disabled projects remain single-agent. Every WorkItem is
still claimed atomically, and one host session may own at most one active item.

The coding-agent host—not dongo—creates agents, Git worktrees, and branches.
Parallel admission requires the host to explicitly report support for parallel
execution and worktree isolation and to identify the Run as using an isolated
worktree. Unsupported, missing, or undisclosed capability stays on the safe
serial path. Reported capability is never trusted as authorization and never
overrides project policy, claim ownership, capacity, revision, or lease checks.

Workspace reporting is intentionally bounded. dongo may retain a worktree name
and branch for Run visualization, but never an absolute repository or worktree
path. Repository contents, diffs, and Git history remain local unless a person
or authorized agent explicitly adds them to the project.

## Ideas privacy boundary

Ideas are a human-only project backlog. Agent installations cannot list, search,
download, claim, sync, or mutate them, and Ideas do not appear in agent Overview
or update delivery. Files attached only to an Idea remain outside agent
attachment access.

Only an authenticated project member can deliberately promote an open Idea.
That atomic action creates one Intake, preserves a permanent link in both
records, and makes the promoted attachments available through the Intake's
normal project-scoped controls. Retries and later promotion attempts resolve to
the original Intake rather than creating duplicates. Promotion does not grant
an agent additional repository access or permission to begin work.

## Data and retention

dongo retains the shared project record needed for people and agents to continue work across sessions. This includes work, comments, status, decisions, account and access records, and files explicitly attached to the project.

Repository source, diffs, Git history, shell history, environment variables, local credentials, browser sessions, and repository-provider accounts are not collected automatically. A local agent can still share content it is allowed to read, so existing agent permissions and repository data-handling rules remain important.

The current service does not offer customer-configurable retention windows or self-service project deletion. Treat content added to a project as retained until dongo provides an explicit deletion process.

## Current assurance

dongo describes only the safeguards it operates today. It does not present an infrastructure provider's certification as a dongo certification and does not currently claim SOC 2 or ISO 27001 certification.

For customer-facing security information, visit [dongo.so/security](https://dongo.so/security). For vulnerabilities or suspected credential exposure, use the [private reporting process](../../SECURITY.md).

Future local-execution work is gated by the internal
[local runner threat model](local-runner-threat-model.md). That document is a
design and release gate, not a claim that the capability is currently live.
