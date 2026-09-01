import { A } from "@solidjs/router";
import { GuideSection, PublicGuideShell } from "../public-guides/PublicGuideShell";
import securityStyles from "./security.css?inline";

const SECURITY_POLICY = "https://github.com/renewisepunk/dongo/blob/main/SECURITY.md";
const PRIVATE_REPORT = "https://github.com/renewisepunk/dongo/security/advisories/new";

export function SecurityOverview() {
  return (
    <PublicGuideShell page="security">
      <style>{securityStyles}</style>

      <section class="public-guide-hero security-hero" aria-labelledby="security-title">
        <div class="public-guide-hero__copy">
          <p class="eyebrow eyebrow--amber">Security + privacy</p>
          <h1 id="security-title">Your work stays yours.</h1>
          <p>
            Connect coding agents to a shared work queue without handing dongo the keys to your repository. Your source code and local environment stay on the machine running your agent. Only work and files you choose to share cross into dongo.
          </p>
          <div class="public-guide-hero__actions">
            <a class="button button--primary" href="#safeguards">Review our safeguards</a>
            <a class="button" href={PRIVATE_REPORT}>Report a vulnerability <span aria-hidden="true">↗</span></a>
          </div>
        </div>

        <div class="security-boundary" aria-label="dongo data boundary">
          <div class="security-boundary__head"><span>Your environment</span><span>Your choice</span></div>
          <div class="security-boundary__zone">
            <span>Customer-controlled</span>
            <strong>Repository · Git state · local environment</strong>
            <small>These remain under your agent host's permissions.</small>
          </div>
          <div class="security-boundary__gate">
            <span aria-hidden="true">↓</span>
            <b>Only what you choose to share</b>
          </div>
          <div class="security-boundary__zone security-boundary__zone--cloud">
            <span>dongo</span>
            <strong>Work items · comments · explicit attachments</strong>
            <small>Shared within the project you approved.</small>
          </div>
        </div>
      </section>

      <div class="security-facts" aria-label="Security principles">
        <div><strong>Local</strong><span>repository and Git state</span></div>
        <div><strong>Scoped</strong><span>each approved connection</span></div>
        <div><strong>Explicit</strong><span>work and files you share</span></div>
        <div><strong>Revocable</strong><span>agent access</span></div>
      </div>

      <GuideSection
        index="01"
        id="safeguards"
        title="Security without broad repository access."
        lede="dongo is built to coordinate work, not inspect your codebase."
      >
        <div class="security-control-grid">
          <article><span>Repository boundary</span><h3>Your code stays local</h3><p>dongo does not automatically browse, mirror, or scan your repository.</p></article>
          <article><span>Intentional sharing</span><h3>You choose what crosses</h3><p>Work records and files enter dongo only when a person or authorized agent adds them to the project.</p></article>
          <article><span>Project scope</span><h3>Connections stay contained</h3><p>Each agent connection is approved for one project rather than your entire account.</p></article>
          <article><span>Revocable access</span><h3>You stay in control</h3><p>Disconnect an installation when it should no longer read or update that project.</p></article>
        </div>
        <div class="guide-callout guide-callout--warning">
          <span class="guide-callout__label">Your local boundary</span>
          <div>
            <h3>Agent permissions still matter.</h3>
            <p>A local agent can share content it is allowed to read. Keep your existing agent permissions and repository data-handling rules in place.</p>
          </div>
        </div>
      </GuideSection>

      <GuideSection
        index="02"
        id="access"
        title="Access stays under your control."
        lede="Every person and agent is approved for a project, checked on each action, and represented by its own identity."
      >
        <div class="security-control-grid">
          <article><span>Human approval</span><h3>You authorize the connection</h3><p>An agent cannot join a project until a person with access approves it.</p></article>
          <article><span>Separate identity</span><h3>Agents act as themselves</h3><p>Agent activity is attributed to the installation that performed it—not to the person who approved it.</p></article>
          <article><span>Project authorization</span><h3>Every action is checked</h3><p>dongo verifies that the actor is allowed to access the project before returning or changing project data.</p></article>
          <article><span>Clear activity</span><h3>Work remains accountable</h3><p>Claims, updates, comments, and decisions stay attached to the person or agent responsible.</p></article>
        </div>
      </GuideSection>

      <GuideSection
        index="03"
        id="privacy"
        title="Collect less. Share intentionally."
        lede="dongo keeps the work record your team needs to coordinate while leaving repository content where it already lives."
      >
        <div class="security-data-grid">
          <article>
            <span>Shared with dongo</span>
            <h3>The project record you create</h3>
            <ul>
              <li>Work, comments, status, and decisions</li>
              <li>Files you explicitly attach</li>
              <li>Account and activity data needed to operate the service</li>
            </ul>
          </article>
          <article>
            <span>Not collected automatically</span>
            <h3>Your local development environment</h3>
            <ul>
              <li>Repository source, diffs, and Git history</li>
              <li>Shell history, environment variables, and local credentials</li>
              <li>Browser sessions and repository-provider accounts</li>
            </ul>
          </article>
        </div>
        <div class="guide-callout">
          <span class="guide-callout__label">A durable work record</span>
          <div>
            <h3>Shared work persists between sessions.</h3>
            <p>That continuity is what lets people and agents pick up where they left off. Do not add secrets or content your team does not want in project history.</p>
          </div>
        </div>
      </GuideSection>

      <GuideSection
        index="04"
        id="assurance"
        title="Claims you can trust."
        lede="We describe the safeguards dongo operates today and do not present an infrastructure provider's certification as our own."
      >
        <div class="security-assurance">
          <article><span>Tested boundaries</span><h3>Critical controls are verified</h3><p>Authorization, project isolation, revocation, and file access are covered by automated tests.</p></article>
          <article><span>Environment isolation</span><h3>Production stands apart</h3><p>Development access cannot be used to authenticate to production.</p></article>
          <article><span>Current assurance</span><h3>No borrowed badges</h3><p>dongo does not currently claim SOC 2 or ISO 27001 certification.</p></article>
        </div>

        <div class="security-report">
          <div><span>Found a vulnerability?</span><h3>Report it privately.</h3><p>Please avoid public issues and include only the information needed for us to investigate safely.</p></div>
          <div class="security-report__actions">
            <a class="button" href={SECURITY_POLICY}>Read the policy <span aria-hidden="true">↗</span></a>
            <a class="button button--primary" href={PRIVATE_REPORT}>Open a private report <span aria-hidden="true">↗</span></a>
          </div>
        </div>

        <div class="guide-next">
          <div><span>Ready to connect?</span><strong>Start with one project and expand when you are comfortable.</strong></div>
          <A class="button button--primary" href="/get-started">Connect a project <span aria-hidden="true">→</span></A>
        </div>
      </GuideSection>
    </PublicGuideShell>
  );
}
