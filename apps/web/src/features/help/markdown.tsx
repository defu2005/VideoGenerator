import type { ReactNode } from "react";

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: InlineNode[] }
  | { type: "image"; alt: string; src: string };

export type MarkdownBlock =
  | { type: "heading"; level: number; id: string; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "code"; text: string }
  | { type: "table"; header: InlineNode[][]; rows: InlineNode[][][] };

/** Turn a guide-relative link into an in-app help URL. External URLs stay as written. */
export function rewriteGuideHref(href: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return href;
  const [file, hash] = href.split("#");
  const page = file.replace(/^\.\//, "").replace(/\.md$/i, "");
  if (!page) return hash ? `#${hash}` : href;
  return hash ? `/help/${page}#${hash}` : `/help/${page}`;
}

function parseHeading(raw: string): { title: string; id: string } {
  const match = raw.match(/^(.*?)\s*\{#([A-Za-z0-9-]+)\}\s*$/);
  if (match) {
    const title = match[1].trim();
    return { title, id: match[2] };
  }
  const title = raw.trim();
  const id = title
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return { title, id };
}

export function parseInline(input: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let index = 0;
  const flush = () => {
    if (!buffer) return;
    nodes.push({ type: "text", text: buffer });
    buffer = "";
  };
  while (index < input.length) {
    if (input.startsWith("![", index)) {
      const match = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(input.slice(index));
      if (match) {
        flush();
        nodes.push({ type: "image", alt: match[1], src: match[2] });
        index += match[0].length;
        continue;
      }
    }
    if (input[index] === "[") {
      const match = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(input.slice(index));
      if (match) {
        flush();
        nodes.push({ type: "link", href: rewriteGuideHref(match[2]), children: parseInline(match[1]) });
        index += match[0].length;
        continue;
      }
    }
    if (input[index] === "`") {
      const end = input.indexOf("`", index + 1);
      if (end > index) {
        flush();
        nodes.push({ type: "code", text: input.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    if (input.startsWith("**", index)) {
      const end = input.indexOf("**", index + 2);
      if (end > index) {
        flush();
        nodes.push({ type: "bold", children: parseInline(input.slice(index + 2, end)) });
        index = end + 2;
        continue;
      }
    }
    if (input[index] === "*") {
      const end = input.indexOf("*", index + 1);
      if (end > index) {
        flush();
        nodes.push({ type: "italic", children: parseInline(input.slice(index + 1, end)) });
        index = end + 1;
        continue;
      }
    }
    buffer += input[index];
    index += 1;
  }
  flush();
  return nodes;
}

function splitCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  const paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
    paragraph.length = 0;
  };
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith("```")) {
      flushParagraph();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        body.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", text: body.join("\n") });
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      const parsed = parseHeading(heading[2]);
      blocks.push({
        type: "heading",
        level: heading[1].length,
        id: parsed.id,
        children: parseInline(parsed.title),
      });
      index += 1;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      flushParagraph();
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: InlineNode[][] = [];
      while (index < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
        const text = lines[index].replace(/^\s*([-*]|\d+\.)\s+/, "");
        items.push(parseInline(text));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && isSeparator(lines[index + 1])) {
      flushParagraph();
      const header = splitCells(line).map((cell) => parseInline(cell));
      index += 2;
      const rows: InlineNode[][][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
        rows.push(splitCells(lines[index]).map((cell) => parseInline(cell)));
        index += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      index += 1;
      continue;
    }
    paragraph.push(line.trim());
    index += 1;
  }
  flushParagraph();
  return blocks;
}

function renderInline(nodes: InlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === "text") return node.text;
    if (node.type === "bold") return <strong key={key}>{renderInline(node.children, key)}</strong>;
    if (node.type === "italic") return <em key={key}>{renderInline(node.children, key)}</em>;
    if (node.type === "code") return <code key={key}>{node.text}</code>;
    if (node.type === "image") return <img key={key} alt={node.alt} src={node.src} />;
    return <a key={key} href={node.href}>{renderInline(node.children, key)}</a>;
  });
}

export function MarkdownView({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="help-doc">
      {blocks.map((block, index) => {
        const key = `b-${index}`;
        if (block.type === "heading") {
          const Tag = `h${Math.min(block.level, 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
          return <Tag key={key} id={block.id}>{renderInline(block.children, key)}</Tag>;
        }
        if (block.type === "paragraph") return <p key={key}>{renderInline(block.children, key)}</p>;
        if (block.type === "code") return <pre key={key}><code>{block.text}</code></pre>;
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <table key={key}>
            <thead>
              <tr>{block.header.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell, `${key}-h-${cellIndex}`)}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => <td key={cellIndex}>{renderInline(cell, `${key}-${rowIndex}-${cellIndex}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </div>
  );
}
