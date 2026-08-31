import { Link, Meta, MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { ErrorBoundary, Show, Suspense } from "solid-js";
import { AuthFrame } from "./components/AuthFrame";
import globalStyles from "./styles/global.css?inline";

function SafeApplicationError() {
  return (
    <AuthFrame>
      <div class="auth-stack">
        <div class="title-group">
          <div class="eyebrow eyebrow--amber">Recovery</div>
          <h1 class="auth-title">dongo could not finish loading</h1>
          <p class="auth-lede">Your work was not changed. Reload the current screen, or return home and choose the project again.</p>
        </div>
        <button class="button button--primary button--full" type="button" onClick={() => window.location.reload()}>
          Reload dongo
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
          <Title>dongo — agent work, without the project management</Title>
          <Meta name="color-scheme" content="dark" />
          <Meta name="theme-color" content="#08080a" />
          <Show when={(import.meta.env.VITE_DONGO_ENVIRONMENT || "development") !== "production"}>
            <Meta name="robots" content="noindex,nofollow,noarchive" />
          </Show>
          <Link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <Link rel="icon" href="/favicon.ico" sizes="32x32" />
          <Link rel="apple-touch-icon" href="/apple-touch-icon.png" />
          <Meta
            name="description"
            content="Give coding agents work, see what they are doing, and answer when they need you."
          />
          <style>{globalStyles}</style>
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
