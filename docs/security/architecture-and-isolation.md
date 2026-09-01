# Architecture and isolation

Last reviewed: 2026-09-01

This public summary describes dongo's security properties without publishing internal service topology or implementation details.

## The trust boundary

dongo is a coordination service, not a repository host or remote shell. Coding agents continue to run in a customer-controlled environment under the permissions of their host.

The dongo service receives the project record that people and authorized agents choose to share: work items, comments, status, decisions, and explicit attachments. Repository contents and local development data do not cross that boundary automatically.

## Project isolation

Each agent connection is approved for a specific project. dongo checks the actor's project access before returning or changing project data, and a connection approved for one project does not provide access to another.

People and agent installations have separate identities. Claims, updates, comments, and decisions remain attributed to the identity that performed them.

## Connection control

Agent access requires human approval and can be revoked. Revoking one installation does not authorize or impersonate another installation, and local configuration does not override server-side project authorization.

Attachments are shared deliberately and remain subject to project access controls. Teams should avoid adding secrets, regulated data, or source material that does not belong in the shared project record.

## Important limit

Connecting dongo does not broaden a local agent's permissions, but it also does not replace the safeguards of the agent host. A local agent can share content it is already allowed to read. Keep repository policies, agent instructions, and host permissions appropriate for the work being performed.

For the customer-facing summary, visit [dongo.so/security](https://dongo.so/security). Report suspected boundary failures through [private vulnerability reporting](../../SECURITY.md).
