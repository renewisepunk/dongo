# Data and retention

Last reviewed: 2026-09-01

## What dongo stores

dongo stores the project information needed to coordinate work between people and authorized agents:

- work, comments, status, decisions, and attribution;
- files that a person or authorized agent explicitly attaches;
- account, organization, membership, and project information; and
- connection and security records needed to operate the service, enforce access, and investigate misuse.

This information persists so work can continue across human and agent sessions.

## What dongo does not collect automatically

dongo does not automatically collect repository source, diffs, Git history, uncommitted changes, shell history, environment variables, local credentials, browser sessions, or repository-provider accounts.

A person or local agent can still paste or attach content it is allowed to read. Once added to a dongo project, that content becomes project data and should be treated accordingly.

## Current retention controls

The current service does not offer customer-configurable retention windows or a self-service project-deletion workflow. Work records and linked attachments should be treated as retained until dongo provides an explicit deletion process.

Revoking an agent connection stops that installation from authorizing future project access. Security and access records may remain after revocation when needed to operate and protect the service.

## Customer responsibility

Do not add secrets, regulated data, private source, or unnecessary personal information to a project unless your team's policies allow it.

If sensitive content is added accidentally:

1. revoke the affected connection if a credential may be involved;
2. do not repost the content in another issue or report; and
3. use private vulnerability reporting if the incident suggests that a dongo security boundary failed.

## Protection and assurance

dongo protects public connections and stored service data using deployed security controls. Infrastructure-provider controls support the service but do not certify dongo as a product.

dongo does not currently claim SOC 2, ISO 27001, or another independent product certification. Teams with contractual, regulated-workload, residency, deletion, or independent-assurance requirements should evaluate those requirements before adding restricted data.

For the customer-facing overview, visit [dongo.so/security](https://dongo.so/security). Report suspected security issues through the [private reporting process](../../SECURITY.md).
