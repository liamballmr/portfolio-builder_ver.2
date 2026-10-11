export type JsonScalar = string | number | boolean | null;

export type RichTextNode = {
  type: string;
  text?: string;
  attrs?: Record<string, JsonScalar>;
  marks?: Array<{ type: string; attrs?: Record<string, JsonScalar> }>;
  content?: RichTextNode[];
};

export type PageStyle =
  | "opening"
  | "text"
  | "full-image"
  | "image-text"
  | "gallery"
  | "video";

export type PortfolioChapter = {
  id: string;
  section: "about" | "project";
  type: PageStyle;
  eyebrow: string;
  title: string;
  year: string;
  role: string;
  summary: string;
  body: RichTextNode;
  assetIds: string[];
  externalUrl: string;
  startNewPage: boolean;
};

export type PortfolioContent = {
  profile: {
    name: string;
    bookTitle: string;
    descriptor: string;
    coverTitle: string;
    coverIntro: string;
    year: string;
    coverAssetId: string;
  };
  chapters: PortfolioChapter[];
  contact: {
    title: string;
    message: string;
    email: string;
    links: Array<{ id: string; label: string; url: string }>;
  };
  publishedAssets?: Record<string, {
    path: string;
    altText: string;
    caption: string;
    width: number;
    height: number;
    focusX: number;
    focusY: number;
  }>;
};

export type PortfolioAsset = {
  id: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  altText: string;
  caption: string;
  focusX: number;
  focusY: number;
  status: "ready" | "processing" | "failed";
  createdAt: string;
  src?: string;
  publishedPath?: string;
  signedUrl?: string;
  previewError?: string;
};

const richText = (...paragraphs: string[]): RichTextNode => ({
  type: "doc",
  content: paragraphs.map((text) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  })),
});

export const DEFAULT_CONTENT: PortfolioContent = {
  profile: {
    name: "Liam",
    bookTitle: "Portfolio",
    descriptor: "Independent practice · 2026",
    coverTitle: "Selected work,\nthoughtfully made.",
    coverIntro: "A collection of ideas, experiments, and outcomes.",
    year: "2026",
    coverAssetId: "",
  },
  chapters: [
    {
      id: "about-liam",
      section: "about",
      type: "text",
      eyebrow: "A LITTLE ABOUT ME",
      title: "Hello, I’m Liam.",
      year: "",
      role: "",
      summary: "",
      body: richText(
        "This space is for a short, personal introduction: what Liam cares about, how he likes to work, and the kinds of problems he enjoys solving.",
        "The final biography and any professional details should be supplied and approved by Liam.",
      ),
      assetIds: [],
      externalUrl: "",
      startNewPage: true,
    },
    {
      id: "project-one",
      section: "project",
      type: "opening",
      eyebrow: "PROJECT 01 · OPENING",
      title: "A project, from first question to final form.",
      year: "Year not provided",
      role: "Role not provided",
      summary: "A concise introduction to a selected piece of work will go here.",
      body: richText(
        "Describe the task, the people it served, and the constraints that shaped the work. Keep the context clear before introducing the solution.",
        "A useful case study makes the reasoning visible, not just the finished screen.",
      ),
      assetIds: [],
      externalUrl: "",
      startNewPage: true,
    },
  ],
  contact: {
    title: "Let’s make something meaningful.",
    message: "For project enquiries, collaborations, or a good conversation:",
    email: "",
    links: [],
  },
};

export function isPortfolioContent(value: unknown): value is PortfolioContent {
  if (!value || typeof value !== "object") return false;
  const content = value as Partial<PortfolioContent>;
  const isTextDocument = (node: unknown, depth = 0, count = { value: 0 }): node is RichTextNode => {
    if (!node || typeof node !== "object" || depth > 30 || count.value++ > 5000) return false;
    const item = node as Partial<RichTextNode>;
    if (typeof item.type !== "string" || !["doc", "paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "hardBreak", "horizontalRule", "text"].includes(item.type)) return false;
    if (item.text !== undefined && typeof item.text !== "string") return false;
    if (item.content !== undefined && (!Array.isArray(item.content) || !item.content.every((child) => isTextDocument(child, depth + 1, count)))) return false;
    if (item.marks !== undefined && (!Array.isArray(item.marks) || !item.marks.every((mark) => mark && ["bold", "italic", "strike", "code", "link"].includes(mark.type) && (mark.type !== "link" || typeof mark.attrs?.href === "string")))) return false;
    if (item.attrs !== undefined && (!item.attrs || typeof item.attrs !== "object" || Object.values(item.attrs).some((attribute) => attribute !== null && !["string", "number", "boolean"].includes(typeof attribute)))) return false;
    return true;
  };
  const profile = content.profile;
  const chapters = content.chapters;
  const contact = content.contact;
  return Boolean(
    profile &&
    typeof profile.name === "string" &&
    typeof profile.bookTitle === "string" &&
    typeof profile.descriptor === "string" &&
    typeof profile.coverTitle === "string" &&
    typeof profile.coverIntro === "string" &&
    typeof profile.year === "string" &&
    typeof profile.coverAssetId === "string" &&
    (!profile.coverAssetId || /^[0-9a-f-]{36}$/i.test(profile.coverAssetId)) &&
    chapters &&
    Array.isArray(chapters) &&
    chapters.length <= 100 &&
    new Set(chapters.map((chapter) => chapter.id)).size === chapters.length &&
    chapters.every((chapter) =>
      chapter &&
      typeof chapter.id === "string" &&
      (chapter.section === "about" || chapter.section === "project") &&
      ["opening", "text", "full-image", "image-text", "gallery", "video"].includes(chapter.type) &&
      typeof chapter.eyebrow === "string" &&
      typeof chapter.title === "string" &&
      typeof chapter.year === "string" &&
      typeof chapter.role === "string" &&
      typeof chapter.summary === "string" &&
      typeof chapter.externalUrl === "string" &&
      typeof chapter.startNewPage === "boolean" &&
      Array.isArray(chapter.assetIds) &&
      chapter.assetIds.length <= 100 &&
      chapter.assetIds.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) &&
      isTextDocument(chapter.body) &&
      chapter.body.type === "doc",
    ) &&
    contact &&
    typeof contact.title === "string" &&
    typeof contact.message === "string" &&
    typeof contact.email === "string" &&
    Array.isArray(contact.links) &&
    contact.links.length <= 30 &&
    contact.links.every((link) => link && typeof link.id === "string" && typeof link.label === "string" && typeof link.url === "string") &&
    (content.publishedAssets === undefined || (
      content.publishedAssets &&
      typeof content.publishedAssets === "object" &&
      Object.values(content.publishedAssets).every((asset) =>
        asset && typeof asset.path === "string" && typeof asset.altText === "string" &&
        typeof asset.caption === "string" && Number.isFinite(asset.width) &&
        Number.isFinite(asset.height) && Number.isFinite(asset.focusX) && Number.isFinite(asset.focusY),
      )
    )),
  );
}

export function collectAssetIds(content: PortfolioContent): string[] {
  return [...new Set([
    content.profile.coverAssetId,
    ...content.chapters.flatMap((chapter) => chapter.assetIds),
  ].filter(Boolean))];
}

export function extractText(document: RichTextNode): string {
  if (document.text) return document.text;
  return (document.content ?? []).map(extractText).join(" ");
}
