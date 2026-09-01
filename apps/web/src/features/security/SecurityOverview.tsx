import { A } from "@solidjs/router";
import { GuideSection, PublicGuideShell } from "../public-guides/PublicGuideShell";
import securityStyles from "./security.css?inline";

const SECURITY_DOCS = "https://github.com/renewisepunk/dongo/tree/main/docs/security";
const SECURITY_DOC_FILE_BASE = "https://github.com/renewisepunk/dongo/blob/main/docs/security";
const SECURITY_POLICY = "https://github.com/renewisepunk/dongo/blob/main/SECURITY.md";
const PRIVATE_REPORT = "https://github.com/renewisepunk/dongo/security/advisories/new";

export function SecurityOverview() {
  return (
    <PublicGuideShell page="security">
      <style>{securityStyles}</style>

      <section class="public-guide-hero security-hero" aria-labelledby="security-title">
        <div class="public-guide-hero__copy">
          <p class="eyebrow eyebrow--amber">Security + data boundary</p>
          <h1 id="security-title">Connect an agent, not your repository.</h1>
          <p>
            dongo exposes a project-scoped work API. It has no cloud tool for your shell, Git history, source tree, environment, or local files. Only structured work and files you explicitly attach cross the boundary.
          </p>
          <div class="public-guide-hero__actions">
            <a class="button button--primary" href="#data-boundary">Inspect the data boundary</a>
            <a class="button" href={SECURITY_DOCS}>Read the security docs <span aria-hidden="true">↗</span></a>
          </div>
        </div>

        <div class="security-boundary" aria-label="dongo cloud trust boundary">
          <div class="security-boundary__head"><span>trust boundary</span><span>default path</span></div>
          <div class="security-boundary__zone">
            <span>Customer-controlled host</span>
            <strong>Repository · Git state · environment</strong>
            <small>Seen by the local agent under the host's permissions.</small>
          </div>
          <div class="security-boundary__gate">
            <span aria-hidden="true">↓</span>
            <b>Structured work + explicit attachments only</b>
          </div>
          <div class="security-boundary__zone security-boundary__zone--cloud">
            <span>dongo cloud</span>
            <strong>Project records · grants · attached files</strong>
            <small>No shell, filesystem, Git, or repository-provider operation.</small>
          </div>
        </div>
      </section>

      <div class="security-facts" aria-label="Security facts">
        <div><strong>0</strong><span>automatic repository reads</span></div>
        <div><strong>18</strong><span>fixed MCP operations</span></div>
        <div><strong>1</strong><span>project per OAuth grant</span></div>
        <div><strong>5 min</strong><span>attachment download links</span></div>
      </div>

      <GuideSection
        index="01"
        id="data-boundary"
        title="Repository content stays local by default."
        lede="The technical contract has no general repository-reading capability. What dongo sees is explicit and reviewable."
      >
        <div class="security-data-grid">
          <article>
            <span>Sent when you use dongo</span>
            <h3>The shared work record</h3>
            <ul>
              <li>Work titles, goals, comments, status, and attention requests</li>
              <li>Agent identity, runs, claims, and artifact references</li>
              <li>An optional repository URL used as project metadata</li>
              <li>Images and files a human explicitly attaches</li>
              <li>Installation, scope, project, and revocation metadata</li>
            </ul>
          </article>
          <article>
            <span>No automatic cloud path</span>
            <h3>Your machine and source tree</h3>
            <ul>
              <li>Repository files, diffs, uncommitted changes, and Git objects</li>
              <li>Shell history, commands, processes, or terminal output</li>
              <li>Environment variables, local credentials, or home-directory files</li>
              <li>Browser sessions, repository-provider accounts, or SSH keys</li>
              <li>Background scanning or repository mirroring</li>
            </ul>
          </article>
        </div>
        <div class="guide-callout guide-callout--warning">
          <span class="guide-callout__label">The honest caveat</span>
          <div>
            <h3>Local agents can still choose what they send.</h3>
            <p>If an agent pastes source, a log, or a secret into a comment—or uploads it as a file—that content becomes dongo project data. Repository isolation does not replace agent-host permissions or repository data-handling rules.</p>
          </div>
        </div>
      </GuideSection>

      <GuideSection
        index="02"
        id="authorization"
        title="Every agent gets a narrow, revocable identity."
        lede="A dongo connection is not an account-wide API key. The person approves one client for one project and the server derives the actor and tenant on every call."
      >
        <div class="security-flow" aria-label="Authorization flow">
          <span>Human approval</span><b aria-hidden="true">→</b>
          <span>Project grant</span><b aria-hidden="true">→</b>
          <span>Bounded MCP tool</span><b aria-hidden="true">→</b>
          <span>Attributed result</span>
        </div>
        <div class="security-control-grid">
          <article><span>OAuth + PKCE</span><h3>Browser consent, no copied token</h3><p>HTTPS discovery and PKCE protect interactive authorization. Access and refresh tokens are never displayed in normal setup.</p></article>
          <article><span>Exact audience</span><h3>A token cannot switch projects</h3><p>The gateway validates issuer, time bounds, exact MCP resource, allowed scopes, client, installation, and project binding.</p></article>
          <article><span>Live revocation</span><h3>Revoked means rejected next</h3><p>Authenticated MCP requests are introspected without a positive token cache. Revocation blocks the next request.</p></article>
          <article><span>Independent actor</span><h3>The agent acts as itself</h3><p>Each CLI or MCP installation has its own actor and grant. It never posts under the human who approved it.</p></article>
        </div>
        <div class="guide-callout guide-callout--green">
          <span class="guide-callout__label">Downstream boundary</span>
          <div><h3>The inbound bearer token stops at the gateway.</h3><p>dongo validates it, then calls the data layer with a short-lived signed internal context. The MCP credential is never passed through to Convex or another service.</p></div>
        </div>
      </GuideSection>

      <GuideSection
        index="03"
        id="retention"
        title="Zero repository retention—not zero product data."
        lede="dongo is useful because work survives between human and agent sessions. The retention model must say exactly which data persists."
      >
        <div class="security-retention" role="table" aria-label="dongo data retention summary">
          <div class="security-retention__head" role="row"><span role="columnheader">Data</span><span role="columnheader">Current behavior</span><span role="columnheader">Control</span></div>
          <div role="row"><strong role="cell">Repository source + local machine data</strong><span role="cell">Not collected by default</span><span role="cell">No cloud operation exists</span></div>
          <div role="row"><strong role="cell">Work, comments, status + attention</strong><span role="cell">Persistent project state</span><span role="cell">No configurable window in v1</span></div>
          <div role="row"><strong role="cell">Explicit attachments</strong><span role="cell">Retained when linked</span><span role="cell">Five-minute read capability</span></div>
          <div role="row"><strong role="cell">CLI credential</strong><span role="cell">Owner-only local file</span><span role="cell">Logout + server revocation</span></div>
          <div role="row"><strong role="cell">MCP grant + installation</strong><span role="cell">Server authorization state</span><span role="cell">Independently revocable</span></div>
          <div role="row"><strong role="cell">Worker logs + sampled traces</strong><span role="cell">Provider telemetry</span><span role="cell">Cloudflare: 3–7 days</span></div>
        </div>
        <p class="security-retention__note">
          Current v1 does not offer customer-configurable retention, a self-service project-erasure flow, customer-managed encryption keys, or a contractual deletion SLA. Teams that require those controls should treat them as blockers—not assumptions.
        </p>
        <a class="security-text-link" href={`${SECURITY_DOC_FILE_BASE}/data-and-retention.md`}>Read the complete retention matrix <span aria-hidden="true">→</span></a>
      </GuideSection>

      <GuideSection
        index="04"
        id="isolation"
        title="Isolation is enforced at every hop."
        lede="The public URL is not the tenant boundary. Identity, resource, scopes, installation, organization, and project are re-established server-side."
      >
        <div class="security-infrastructure">
          <article><span>Edge</span><h3>Cloudflare Workers + D1</h3><p>Public web, OAuth, agent API, MCP, attachment, and notification boundaries. OAuth state lives separately from work data.</p></article>
          <article><span>Product state</span><h3>Convex</h3><p>Accounts, memberships, projects, work, comments, attention, actor identity, and attachment metadata with server-derived tenant checks.</p></article>
          <article><span>Attachment bytes</span><h3>Private Cloudflare R2</h3><p>Exact-object signed capabilities, private/no-store responses, TLS in transit, and provider-managed AES-256 encryption at rest.</p></article>
        </div>
        <div class="security-environment-grid">
          <div><span>development</span><code>dev.dongo.so</code></div>
          <b aria-hidden="true">≠</b>
          <div><span>production</span><code>dongo.so</code></div>
        </div>
        <p class="guide-inline-note"><span>›</span>Separate issuers, resources, secrets, Workers, R2 buckets, and Convex deployments prevent a development credential from authenticating to production.</p>
      </GuideSection>

      <GuideSection
        index="05"
        id="assurance"
        title="Evidence, not inherited badges."
        lede="Cloudflare and Convex publish strong platform controls. Those controls support dongo, but their certifications do not automatically certify dongo itself."
      >
        <div class="security-assurance">
          <article>
            <span>Available evidence</span>
            <ul>
              <li>Public source and generated MCP/API contracts</li>
              <li>Tenant, authorization, revocation, attachment, and environment-boundary tests</li>
              <li>Production release evidence for CLI and MCP lifecycles</li>
              <li>Secret scanning and committed-secret checks</li>
              <li>Runtime log checks that reject raw exception messages</li>
              <li>Confidential vulnerability reporting through GitHub</li>
            </ul>
          </article>
          <article>
            <span>Not claimed today</span>
            <ul>
              <li>dongo SOC 2 or ISO 27001 certification</li>
              <li>Independent penetration test of the complete service</li>
              <li>SAML SSO, SCIM, customer SIEM export, or custom enterprise roles</li>
              <li>Customer-selected residency or customer-managed encryption keys</li>
              <li>Published dongo DPA, subprocessor change policy, or deletion SLA</li>
              <li>Suitability for regulated data without separate review</li>
            </ul>
          </article>
        </div>
        <div class="guide-callout guide-callout--warning">
          <span class="guide-callout__label">Compliance position</span>
          <div><h3>Provider certification is not product certification.</h3><p>dongo does not currently claim an independent compliance certification. If your policy requires one of the controls above, do not connect regulated or restricted repositories until the requirement is met.</p></div>
        </div>
      </GuideSection>

      <GuideSection
        index="06"
        id="evidence"
        title="Audit the boundary yourself."
        lede="The contract, implementation, tests, release evidence, and disclosure process are public. Security-sensitive reports have a private channel."
      >
        <div class="security-resources">
          <a href={`${SECURITY_DOC_FILE_BASE}/architecture-and-isolation.md`}><span>Architecture</span><strong>Trust boundary + tenant isolation</strong><b aria-hidden="true">↗</b></a>
          <a href={`${SECURITY_DOC_FILE_BASE}/data-and-retention.md`}><span>Data</span><strong>Complete retention matrix</strong><b aria-hidden="true">↗</b></a>
          <a href={SECURITY_POLICY}><span>Policy</span><strong>Security reporting policy</strong><b aria-hidden="true">↗</b></a>
          <a href="https://github.com/renewisepunk/dongo/blob/main/docs/release/production-launch-2026-08-31.md"><span>Evidence</span><strong>Production verification record</strong><b aria-hidden="true">↗</b></a>
        </div>
        <div class="security-report">
          <div><span>Found a vulnerability?</span><h3>Report it privately.</h3><p>Do not open a public issue or include active credentials, signed URLs, or customer data. Revoke exposed access first, then send the minimum reproducible evidence.</p></div>
          <a class="button button--primary" href={PRIVATE_REPORT}>Open a private report <span aria-hidden="true">↗</span></a>
        </div>
        <div class="guide-next">
          <div><span>Ready to connect?</span><strong>Start with one repository and one project-scoped grant.</strong></div>
          <A class="button" href="/get-started">Get started <span aria-hidden="true">→</span></A>
        </div>
      </GuideSection>
    </PublicGuideShell>
  );
}
