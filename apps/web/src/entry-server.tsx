import { createHandler, StartServer } from "@solidjs/start/server";
import type { JSX } from "solid-js";
import { canonicalRedirectUrl } from "./lib/canonical-origin";

function Document(props: { assets?: JSX.Element; scripts?: JSX.Element; children?: JSX.Element }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {props.assets}
      </head>
      <body>
        <div id="app">{props.children}</div>
        {props.scripts}
      </body>
    </html>
  );
}

const startHandler = createHandler(() => <StartServer document={Document} />);

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const redirectUrl = canonicalRedirectUrl(request.url, env.DONGO_PUBLIC_ORIGIN);
    if (redirectUrl !== undefined) {
      return Response.redirect(redirectUrl, 308);
    }
    return startHandler.fetch(request);
  },
} satisfies {
  fetch(request: Request, env: Env): Response | Promise<Response>;
};
