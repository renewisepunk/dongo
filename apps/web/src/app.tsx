import { Link, Meta, MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import "./styles/global.css";

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
          <Suspense>{props.children}</Suspense>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
