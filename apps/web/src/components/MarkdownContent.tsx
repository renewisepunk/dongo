import { For, Show, type JSX } from "solid-js";
import { marked, type Token, type Tokens } from "marked";
import { safeMarkdownHref } from "../lib/markdown";

export type MarkdownContentProps = {
  source: string;
  class?: string;
};

export type MarkdownDraftPreviewProps = {
  source: string;
  label: string;
};

function inlineTokens(tokens: Token[]): JSX.Element {
  return <For each={tokens}>{(token) => inlineToken(token)}</For>;
}

function inlineToken(token: Token): JSX.Element {
  switch (token.type) {
    case "text": {
      const text = token as Tokens.Text;
      return text.tokens?.length ? inlineTokens(text.tokens) : text.text;
    }
    case "escape":
      return (token as Tokens.Escape).text;
    case "strong":
      return <strong>{inlineTokens((token as Tokens.Strong).tokens)}</strong>;
    case "em":
      return <em>{inlineTokens((token as Tokens.Em).tokens)}</em>;
    case "del":
      return <del>{inlineTokens((token as Tokens.Del).tokens)}</del>;
    case "codespan":
      return <code>{(token as Tokens.Codespan).text}</code>;
    case "br":
      return <br />;
    case "link": {
      const link = token as Tokens.Link;
      const href = safeMarkdownHref(link.href);
      const content = inlineTokens(link.tokens);
      return href
        ? <a href={href} title={link.title ?? undefined} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>{content}</a>
        : <span>{content}</span>;
    }
    case "image": {
      const image = token as Tokens.Image;
      const href = safeMarkdownHref(image.href);
      const label = image.text.trim() || "linked image";
      return href
        ? <a class="markdown-content__image-link" href={href} title={image.title ?? undefined} target="_blank" rel="noreferrer">{label} <span aria-hidden="true">↗</span></a>
        : label;
    }
    case "html":
      return (token as Tokens.HTML).text;
    default:
      return "text" in token && typeof token.text === "string" ? token.text : token.raw;
  }
}

function heading(token: Tokens.Heading): JSX.Element {
  const content = inlineTokens(token.tokens);
  if (token.depth <= 1) return <h3>{content}</h3>;
  if (token.depth === 2) return <h4>{content}</h4>;
  if (token.depth === 3) return <h5>{content}</h5>;
  return <h6>{content}</h6>;
}

function tableCell(cell: Tokens.TableCell, headingCell: boolean): JSX.Element {
  const style = { "text-align": cell.align ?? "left" } as const;
  return headingCell
    ? <th style={style}>{inlineTokens(cell.tokens)}</th>
    : <td style={style}>{inlineTokens(cell.tokens)}</td>;
}

function list(token: Tokens.List): JSX.Element {
  const items = (
    <For each={token.items}>{(item) => (
      <li class={item.task ? "markdown-content__task" : undefined}>
        {item.task ? <span class="markdown-content__checkbox" data-checked={item.checked} aria-label={item.checked ? "Completed" : "Not completed"}>{item.checked ? "✓" : ""}</span> : null}
        <div class="markdown-content__list-copy">{blockTokens(item.tokens)}</div>
      </li>
    )}</For>
  );
  return token.ordered
    ? <ol start={typeof token.start === "number" ? token.start : undefined}>{items}</ol>
    : <ul>{items}</ul>;
}

function blockTokens(tokens: Token[]): JSX.Element {
  return <For each={tokens}>{(token) => blockToken(token)}</For>;
}

function blockToken(token: Token): JSX.Element {
  switch (token.type) {
    case "space":
    case "def":
      return null;
    case "heading":
      return heading(token as Tokens.Heading);
    case "paragraph":
      return <p>{inlineTokens((token as Tokens.Paragraph).tokens)}</p>;
    case "text": {
      const text = token as Tokens.Text;
      return text.tokens?.length ? inlineTokens(text.tokens) : text.text;
    }
    case "code": {
      const code = token as Tokens.Code;
      return (
        <div class="markdown-content__code">
          {code.lang ? <div class="markdown-content__language">{code.lang}</div> : null}
          <pre><code>{code.text}</code></pre>
        </div>
      );
    }
    case "blockquote":
      return <blockquote>{blockTokens((token as Tokens.Blockquote).tokens)}</blockquote>;
    case "list":
      return list(token as Tokens.List);
    case "table": {
      const table = token as Tokens.Table;
      return (
        <div class="markdown-content__table" role="region" aria-label="Scrollable table" tabindex="0">
          <table>
            <thead><tr><For each={table.header}>{(cell) => tableCell(cell, true)}</For></tr></thead>
            <tbody><For each={table.rows}>{(row) => <tr><For each={row}>{(cell) => tableCell(cell, false)}</For></tr>}</For></tbody>
          </table>
        </div>
      );
    }
    case "hr":
      return <hr />;
    case "html":
      return <p class="markdown-content__raw">{(token as Tokens.HTML).text}</p>;
    default:
      return inlineToken(token);
  }
}

export function MarkdownContent(props: MarkdownContentProps) {
  const tokens = () => marked.lexer(props.source, { breaks: true, gfm: true });
  return <div class={`markdown-content${props.class ? ` ${props.class}` : ""}`}>{blockTokens(tokens())}</div>;
}

export function MarkdownDraftPreview(props: MarkdownDraftPreviewProps) {
  return (
    <Show when={props.source.trim()}>
      <details class="markdown-draft-preview">
        <summary>Preview formatted {props.label}</summary>
        <MarkdownContent source={props.source} />
      </details>
    </Show>
  );
}
