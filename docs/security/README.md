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

## Data and retention

dongo retains the shared project record needed for people and agents to continue work across sessions. This includes work, comments, status, decisions, account and access records, and files explicitly attached to the project.

Repository source, diffs, Git history, shell history, environment variables, local credentials, browser sessions, and repository-provider accounts are not collected automatically. A local agent can still share content it is allowed to read, so existing agent permissions and repository data-handling rules remain important.

The current service does not offer customer-configurable retention windows or self-service project deletion. Treat content added to a project as retained until dongo provides an explicit deletion process.

## Current assurance

dongo describes only the safeguards it operates today. It does not present an infrastructure provider's certification as a dongo certification and does not currently claim SOC 2 or ISO 27001 certification.

For customer-facing security information, visit [dongo.so/security](https://dongo.so/security). For vulnerabilities or suspected credential exposure, use the [private reporting process](../../SECURITY.md).
