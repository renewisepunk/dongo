import { Link, Meta, MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { ErrorBoundary, Suspense } from "solid-js";
import { AuthFrame } from "./components/AuthFrame";
import "./styles/global.css";

function SafeApplicationError() {
  return (
    <AuthFrame>
      <div class="auth-stack">
        <div class="title-group">
          <div class="eyebrow eyebrow--amber">Recovery</div>
          <h1 class="auth-title">Dongo could not finish loading</h1>
          <p class="auth-lede">Your work was not changed. Reload the current screen, or return home and choose the project again.</p>
        </div>
        <button class="button button--primary button--full" type="button" onClick={() => window.location.reload()}>
          Reload Dongo
        </button>
        <a class="button button--full" href="/">Return home</a>
        <p class="security-note">No error details or project content are included on this recovery screen.</p>
      </div>
    </AuthFrame>
  );
}

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <Title>Dongo — agent work, without the project management</Title>
          <Meta name="color-scheme" content="dark" />
          <Meta name="theme-color" content="#08080a" />
          <Meta
            name="description"
            content="Give coding agents work, see what they are doing, and answer when they need you."
          />
          <Link rel="preconnect" href="https://api.fontshare.com" />
          <Link
            rel="stylesheet"
            href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600,700&display=swap"
          />
          <ErrorBoundary fallback={<SafeApplicationError />}>
            <Suspense>{props.children}</Suspense>
          </ErrorBoundary>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
