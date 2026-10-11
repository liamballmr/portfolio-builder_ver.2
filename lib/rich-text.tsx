import type { ReactNode } from "react";
import type { RichTextNode } from "./portfolio";

function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  return null;
}

function renderNode(node: RichTextNode, key: string): ReactNode {
  if (node.type === "text") {
    let value: ReactNode = node.text ?? "";
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") value = <strong key={`${key}-bold`}>{value}</strong>;
      else if (mark.type === "italic") value = <em key={`${key}-italic`}>{value}</em>;
      else if (mark.type === "strike") value = <s key={`${key}-strike`}>{value}</s>;
      else if (mark.type === "code") value = <code key={`${key}-code`}>{value}</code>;
      else if (mark.type === "link") {
        const href = safeHref(mark.attrs?.href);
        if (href) value = <a key={`${key}-link`} href={href} rel={href.startsWith("http") ? "noreferrer" : undefined}>{value}</a>;
      }
    }
    return <span key={key}>{value}</span>;
  }

  const children = (node.content ?? []).map((child, index) => renderNode(child, `${key}-${index}`));
  if (node.type === "doc") return <div key={key} className="rich-text">{children}</div>;
  if (node.type === "paragraph") return <p key={key}>{children}</p>;
  if (node.type === "heading") {
    const level = Math.max(2, Math.min(4, Number(node.attrs?.level) || 2));
    if (level === 2) return <h2 key={key}>{children}</h2>;
    if (level === 3) return <h3 key={key}>{children}</h3>;
    return <h4 key={key}>{children}</h4>;
  }
  if (node.type === "bulletList") return <ul key={key}>{children}</ul>;
  if (node.type === "orderedList") return <ol key={key}>{children}</ol>;
  if (node.type === "listItem") return <li key={key}>{children}</li>;
  if (node.type === "blockquote") return <blockquote key={key}>{children}</blockquote>;
  if (node.type === "hardBreak") return <br key={key} />;
  if (node.type === "horizontalRule") return <hr key={key} />;
  return <span key={key}>{children}</span>;
}

export function RichText({ document }: { document: RichTextNode }) {
  return renderNode(document, "root");
}
