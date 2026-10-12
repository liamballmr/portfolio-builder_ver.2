"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import type {
  PageStyle,
  PortfolioAsset,
  PortfolioChapter,
  PortfolioContent,
  RichTextNode,
} from "@/lib/portfolio";
import {
  deleteAssetAction,
  loadDraftAction,
  publishDraftAction,
  publicationDiffAction,
  rollbackPublicationAction,
  saveDraftAction,
  signOutAction,
  updateAssetAction,
  type ActionResult,
} from "./actions";
import { RichText } from "@/lib/rich-text";

export type PublicationRecord = {
  id: string;
  version: number;
  content: PortfolioContent;
  createdAt: string;
  current: boolean;
};

type Props = {
  initialContent: PortfolioContent;
  initialRevision: number;
  initialUpdatedAt: string;
  initialAssets: PortfolioAsset[];
  publications: PublicationRecord[];
};

type Section = "cover" | "contact" | string;
type SaveState = "saved" | "unsaved" | "saving" | "failed" | "conflict";
type Panel = "editor" | "media" | "versions";

const SITE_ASSET_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const pageStyles: Array<{ value: PageStyle; label: string }> = [
  { value: "opening", label: "Project opening" },
  { value: "text", label: "Text page" },
  { value: "full-image", label: "Full-page image" },
  { value: "image-text", label: "Image + text" },
  { value: "gallery", label: "Image group" },
  { value: "video", label: "Video page" },
];

function safePreviewUrl(value: string) {
  return /^(https:\/\/|mailto:|tel:)/i.test(value.trim());
}

function publicImage(path: string) {
  if (!SITE_ASSET_URL) return "";
  return `${SITE_ASSET_URL.replace(/\/$/, "")}/storage/v1/object/public/portfolio-published/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function prettyDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function PageEditor({
  document,
  onChange,
}: {
  document: RichTextNode;
  onChange: (document: RichTextNode) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        autolink: true,
        protocols: ["mailto", "tel"],
        HTMLAttributes: { rel: "noreferrer" },
      }),
    ],
    content: document,
    onUpdate({ editor: instance }) {
      onChange(instance.getJSON() as RichTextNode);
    },
    editorProps: {
      attributes: {
        class: "tiptap-content",
        "aria-label": "Chapter rich text content",
      },
    },
  });

  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(document)) editor.commands.setContent(document);
  }, [document, editor]);

  if (!editor) return <div className="tiptap-loading">Loading editor…</div>;

  return (
    <div className="tiptap-shell">
      <div className="tiptap-toolbar" role="toolbar" aria-label="Text formatting">
        <button type="button" title="Bold" aria-pressed={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></button>
        <button type="button" title="Italic" aria-pressed={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></button>
        <button type="button" title="Heading 2" aria-pressed={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
        <button type="button" title="Heading 3" aria-pressed={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button>
        <button type="button" title="Bulleted list" aria-pressed={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</button>
        <button type="button" title="Block quote" aria-pressed={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>“ Quote</button>
        <button type="button" title="Add or edit link" aria-pressed={editor.isActive("link")} onClick={() => {
          const oldHref = editor.getAttributes("link").href as string | undefined;
          const href = window.prompt("Enter a secure https://, mailto:, or tel: link. Leave blank to remove it.", oldHref ?? "");
          if (href === null) return;
          if (!href.trim()) editor.chain().focus().unsetLink().run();
          else if (/^(https:\/\/|mailto:|tel:)/i.test(href.trim())) editor.chain().focus().setLink({ href: href.trim() }).run();
          else window.alert("Links must begin with https://, mailto:, or tel:.");
        }}>↗ Link</button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function SortableChapter({
  chapter,
  selected,
  onSelect,
  onMove,
}: {
  chapter: PortfolioChapter;
  selected: boolean;
  onSelect: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chapter.id });
  return (
    <div ref={setNodeRef} className={`admin-nav__chapter ${selected ? "is-current" : ""} ${isDragging ? "is-dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes}>
      <button className="admin-nav__drag" type="button" aria-label={`Drag to reorder ${chapter.title}`} {...listeners}>⠿</button>
      <button className="admin-nav__select" type="button" onClick={onSelect}>
        <span>{chapter.section === "about" ? "ABOUT" : "PROJECT"}</span>
        <strong>{chapter.title || "Untitled chapter"}</strong>
      </button>
      <div className="admin-nav__move">
        <button type="button" aria-label={`Move ${chapter.title} up`} onClick={() => onMove(-1)}>↑</button>
        <button type="button" aria-label={`Move ${chapter.title} down`} onClick={() => onMove(1)}>↓</button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      {multiline
        ? <textarea value={value} placeholder={placeholder} maxLength={maxLength} rows={3} onChange={(event) => onChange(event.target.value)} />
        : <input value={value} placeholder={placeholder} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />}
    </label>
  );
}

function MediaPanel({
  assets,
  selectedIds,
  multiple,
  onSelect,
  onUpload,
  onUpdate,
  onDelete,
  busy,
}: {
  assets: PortfolioAsset[];
  selectedIds: string[];
  multiple: boolean;
  onSelect: (id: string) => void;
  onUpload: (file: File, onProgress: (value: number) => void) => Promise<void>;
  onUpdate: (id: string, values: { altText: string; caption: string; focusX: number; focusY: number }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  busy: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [savingId, setSavingId] = useState("");
  const [metadata, setMetadata] = useState<Record<string, { altText: string; caption: string; focusX: number; focusY: number }>>({});

  useEffect(() => {
    setMetadata(Object.fromEntries(assets.map((asset) => [asset.id, {
      altText: asset.altText,
      caption: asset.caption,
      focusX: asset.focusX,
      focusY: asset.focusY,
    }])));
  }, [assets]);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      await onUpload(file, setUploadProgress);
      setMessage("Image uploaded to private storage. Add alt text before publishing.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const saveMetadata = async (asset: PortfolioAsset) => {
    const value = metadata[asset.id];
    if (!value) return;
    setSavingId(asset.id);
    setMessage("");
    try {
      await onUpdate(asset.id, value);
      setMessage("Image details saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Image details could not be saved.");
    } finally {
      setSavingId("");
    }
  };

  const changeMeta = (asset: PortfolioAsset, key: keyof NonNullable<typeof metadata[string]>, value: string | number) => {
    setMetadata((current) => ({
      ...current,
      [asset.id]: { ...current[asset.id], [key]: value },
    }));
  };

  return (
    <div className="media-panel">
      <div className="media-panel__upload">
        <label className="admin-primary-button admin-upload-button">
          {uploading ? `UPLOADING ${uploadProgress}%…` : "+ UPLOAD IMAGE"}
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading || busy} onChange={onFile} />
        </label>
        <p>JPEG, PNG, or WebP · maximum 15 MB. Originals stay private until you publish.</p>
      </div>
      {message && <p className={`admin-alert ${message.toLowerCase().includes("failed") || message.toLowerCase().includes("could not") ? "admin-alert--error" : ""}`} role="status">{message}</p>}
      {assets.length === 0 ? (
        <div className="admin-empty">No images yet. Upload artwork, then add alternative text and attach it to a page.</div>
      ) : (
        <div className="media-grid">
          {assets.map((asset) => {
            const values = metadata[asset.id] ?? { altText: asset.altText, caption: asset.caption, focusX: asset.focusX, focusY: asset.focusY };
            const chosen = selectedIds.includes(asset.id);
            return (
              <article className={`media-card ${chosen ? "media-card--selected" : ""}`} key={asset.id}>
                <button className="media-card__image" type="button" onClick={() => onSelect(asset.id)} aria-pressed={chosen} aria-label={`${chosen ? "Remove" : "Attach"} ${asset.originalName}`}>
                  {asset.signedUrl
                    ? <img src={asset.signedUrl} alt="" style={{ objectPosition: `${asset.focusX}% ${asset.focusY}%` }} />
                    : <span className="media-card__missing">{asset.previewError ? "PREVIEW UNAVAILABLE" : "PREPARING PREVIEW"}</span>}
                  <span className="media-card__selection">{chosen ? "✓ ATTACHED" : multiple ? "ATTACH IMAGE" : "SELECT COVER"}</span>
                </button>
                <div className="media-card__details">
                  <strong title={asset.originalName}>{asset.originalName}</strong>
                  <span>{asset.width} × {asset.height} · {(asset.byteSize / 1024 / 1024).toFixed(1)} MB</span>
                  <label className="admin-field">
                    <span>Alternative text *</span>
                    <input value={values.altText} maxLength={500} placeholder="Describe the image" onChange={(event) => changeMeta(asset, "altText", event.target.value)} />
                  </label>
                  <label className="admin-field">
                    <span>Caption</span>
                    <input value={values.caption} maxLength={500} placeholder="Optional caption" onChange={(event) => changeMeta(asset, "caption", event.target.value)} />
                  </label>
                  <div className="media-card__focus">
                    <label className="admin-field"><span>Focus X (%)</span><input type="number" min="0" max="100" value={values.focusX} onChange={(event) => changeMeta(asset, "focusX", Number(event.target.value))} /></label>
                    <label className="admin-field"><span>Focus Y (%)</span><input type="number" min="0" max="100" value={values.focusY} onChange={(event) => changeMeta(asset, "focusY", Number(event.target.value))} /></label>
                  </div>
                  <div className="media-card__actions">
                    <button type="button" className="admin-secondary-button" disabled={busy || savingId === asset.id} onClick={() => void saveMetadata(asset)}>{savingId === asset.id ? "SAVING…" : "SAVE DETAILS"}</button>
                    <button type="button" className="admin-danger-button" disabled={busy} onClick={() => void onDelete(asset.id)}>REMOVE</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Preview({
  content,
  chapter,
  contact = false,
  assets,
  mode,
  onOverflowChange,
}: {
  content: PortfolioContent;
  chapter?: PortfolioChapter;
  contact?: boolean;
  assets: PortfolioAsset[];
  mode: "desktop" | "mobile";
  onOverflowChange: (overflow: boolean) => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const displayed = chapter ?? content.chapters[0];
  const attached = displayed?.assetIds.map((id) => assetMap.get(id)).filter((asset): asset is PortfolioAsset => Boolean(asset)) ?? [];
  const previewHasVideo = displayed?.type === "video" && Boolean(displayed.externalUrl && safePreviewUrl(displayed.externalUrl));
  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const checkOverflow = () => onOverflowChange(element.scrollHeight > element.clientHeight + 1);
    checkOverflow();
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(element);
    if (element.firstElementChild instanceof HTMLElement) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [assets, chapter, contact, content, mode, onOverflowChange]);
  return (
    <div ref={previewRef} className={`editor-preview editor-preview--${mode}`}>
      {contact ? (
        <article className="editor-preview__page">
          <span className="page-eyebrow">GET IN TOUCH</span>
          <h2>{content.contact.title}</h2>
          <p>{content.contact.message}</p>
          {content.contact.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content.contact.email) && <a href={`mailto:${content.contact.email}`}>{content.contact.email}</a>}
          {content.contact.links.filter((link) => safePreviewUrl(link.url)).map((link) => <a href={link.url} key={link.id}>{link.label}</a>)}
        </article>
      ) : chapter === undefined ? (
        <div className="editor-preview__cover">
          <span className="page-eyebrow">{content.profile.bookTitle} · {content.profile.year}</span>
          {content.profile.coverAssetId && assetMap.get(content.profile.coverAssetId)?.signedUrl &&
            <img className="editor-preview__cover-image" src={assetMap.get(content.profile.coverAssetId)?.signedUrl} alt="" />}
          <h2>{content.profile.coverTitle}</h2>
          <p>{content.profile.coverIntro}</p>
          <span>{content.profile.name} · {content.profile.descriptor}</span>
        </div>
      ) : displayed ? (
        <article className={`editor-preview__page editor-preview__page--${displayed.type}`}>
          <span className="page-eyebrow">{displayed.eyebrow}</span>
          <h2>{displayed.title}</h2>
          {displayed.section === "project" && <p className="editor-preview__meta">{displayed.year} · {displayed.role}</p>}
          <div className={`page-body editor-preview__body page-body--${displayed.type} ${attached.length || displayed.type === "video" ? "page-body--with-art" : ""}`}>
            <div className="page-copy">
              {displayed.summary && <p className="editor-preview__summary">{displayed.summary}</p>}
              <RichText document={displayed.body} />
              {displayed.externalUrl && safePreviewUrl(displayed.externalUrl) && displayed.type !== "video" && <a href={displayed.externalUrl} target={displayed.externalUrl.startsWith("https://") ? "_blank" : undefined} rel="noreferrer">{displayed.externalUrl}</a>}
            </div>
            {(attached.length > 0 || previewHasVideo) && (
              <div className={`page-media ${attached.length + Number(previewHasVideo) === 1 ? "page-media--single" : ""}`}>
                {previewHasVideo && displayed.externalUrl && (
                  <a className="editor-preview__video" href={displayed.externalUrl} target="_blank" rel="noreferrer">VIDEO PREVIEW ↗<span>{displayed.externalUrl}</span></a>
                )}
                {attached.map((asset) => asset.signedUrl && (
                  <figure key={asset.id}>
                    <img src={asset.signedUrl} alt={asset.altText} style={{ objectPosition: `${asset.focusX}% ${asset.focusY}%` }} />
                    {asset.caption && <figcaption>{asset.caption}</figcaption>}
                  </figure>
                ))}
              </div>
            )}
          </div>
        </article>
      ) : <p className="admin-empty">No preview available.</p>}
      <span className="editor-preview__page-number">PREVIEW · NOT PUBLIC</span>
    </div>
  );
}

export function AdminEditor({
  initialContent,
  initialRevision,
  initialUpdatedAt,
  initialAssets,
  publications,
}: Props) {
  const [content, setContent] = useState(initialContent);
  const [revision, setRevision] = useState(initialRevision);
  const [assets, setAssets] = useState(initialAssets);
  const [activeSection, setActiveSection] = useState<Section>("cover");
  const [panel, setPanel] = useState<Panel>("editor");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveMessage, setSaveMessage] = useState(`Saved ${prettyDate(initialUpdatedAt)}`);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [previewOverflow, setPreviewOverflow] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [publishDialog, setPublishDialog] = useState<{ changes: string[]; revision: number } | null>(null);
  const [previewVersion, setPreviewVersion] = useState<PublicationRecord | null>(null);
  const [dialogMessage, setDialogMessage] = useState("");
  const [contactLinkDraft, setContactLinkDraft] = useState({ label: "", url: "" });
  const [dirty, setDirty] = useState(false);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [latestNotice, setLatestNotice] = useState("");
  const router = useRouter();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const revisionRef = useRef(revision);
  const savingRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => { contentRef.current = content; }, [content]);
  useEffect(() => { revisionRef.current = revision; }, [revision]);

  const updateContent = useCallback((updater: (current: PortfolioContent) => PortfolioContent) => {
    const next = updater(contentRef.current);
    contentRef.current = next;
    setContent(next);
    setDirty(true);
    setSaveState("unsaved");
    setSaveMessage("Unsaved changes");
    setError("");
  }, []);

  const saveNow = useCallback(async (force = false): Promise<boolean> => {
    if (!force && !dirty && saveState === "saved") return true;
    if (savingRef.current) return false;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    savingRef.current = true;
    setSaveState("saving");
    setSaveMessage("Saving draft…");
    const payload = contentRef.current;
    const oldRevision = revisionRef.current;
    let result: ActionResult;
    try {
      result = await saveDraftAction(payload, oldRevision);
    } catch (error) {
      savingRef.current = false;
      const message = error instanceof Error ? error.message : "Draft save request failed.";
      setError(message);
      setSaveState("failed");
      setSaveMessage("Save failed");
      return false;
    }
    savingRef.current = false;
    if (!result.ok) {
      setError(result.error);
      setSaveState(result.conflict ? "conflict" : "failed");
      setSaveMessage(result.conflict ? "Draft conflict" : "Save failed");
      if (result.conflict) setRevisionConflict(true);
      return false;
    }
    if (typeof result.revision !== "number") {
      setError("The server saved the draft but did not return a new revision. Reload the editor before further changes.");
      setSaveState("failed");
      setSaveMessage("Revision update failed");
      return false;
    }
    revisionRef.current = result.revision;
    setRevision(result.revision);
    if (JSON.stringify(contentRef.current) === JSON.stringify(payload)) {
      setDirty(false);
      setSaveState("saved");
      setSaveMessage(`Saved ${prettyDate(new Date().toISOString())}`);
      return true;
    } else {
      setSaveState("unsaved");
      setSaveMessage("Newer changes still need saving");
      return false;
    }
  }, [dirty, saveState]);

  useEffect(() => {
    if (!dirty || saveState === "conflict") return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void saveNow(); }, 1000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [content, dirty, saveNow, saveState]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const poll = window.setInterval(async () => {
      if (document.visibilityState !== "visible" || dirty || savingRef.current) return;
      const data = await loadDraftAction();
      if (data.ok && data.revision && data.revision !== revisionRef.current) setRevisionConflict(true);
      else if (!data.ok) setError(`Could not check for changes in another editor session: ${data.error}`);
    }, 15_000);
    return () => window.clearInterval(poll);
  }, [dirty]);

  const selectedChapter = content.chapters.find((chapter) => chapter.id === activeSection);
  const selectedImages = activeSection === "cover"
    ? content.profile.coverAssetId ? [content.profile.coverAssetId] : []
    : selectedChapter?.assetIds ?? [];
  const currentPreviewContent = previewVersion?.content ?? content;
  const currentPreviewChapter = previewVersion
    ? (previewVersion.content.chapters.find((chapter) => chapter.id === activeSection) ?? previewVersion.content.chapters[0])
    : selectedChapter;
  const imagesForPreview = previewVersion
    ? assets.map((asset) => {
      const details = previewVersion.content.publishedAssets?.[asset.id];
      return details?.path ? { ...asset, signedUrl: publicImage(details.path), altText: details.altText, caption: details.caption } : asset;
    })
    : assets;

  const changeProfile = <K extends keyof PortfolioContent["profile"]>(key: K, value: PortfolioContent["profile"][K]) => {
    updateContent((current) => ({ ...current, profile: { ...current.profile, [key]: value } }));
  };
  const changeContact = <K extends keyof PortfolioContent["contact"]>(key: K, value: PortfolioContent["contact"][K]) => {
    updateContent((current) => ({ ...current, contact: { ...current.contact, [key]: value } }));
  };
  const changeChapter = (id: string, changes: Partial<PortfolioChapter>) => {
    updateContent((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => chapter.id === id ? { ...chapter, ...changes } : chapter),
    }));
  };

  const reorderChapter = (activeId: string, overId: string) => {
    const from = content.chapters.findIndex((chapter) => chapter.id === activeId);
    const to = content.chapters.findIndex((chapter) => chapter.id === overId);
    if (from < 0 || to < 0 || from === to) return;
    updateContent((current) => ({ ...current, chapters: arrayMove(current.chapters, from, to) }));
  };

  const moveChapter = (id: string, direction: -1 | 1) => {
    const index = content.chapters.findIndex((chapter) => chapter.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= content.chapters.length) return;
    updateContent((current) => ({ ...current, chapters: arrayMove(current.chapters, index, next) }));
  };

  const addProject = () => {
    const id = crypto.randomUUID();
    const chapter: PortfolioChapter = {
      id,
      section: "project",
      type: "opening",
      eyebrow: `PROJECT ${String(content.chapters.filter((item) => item.section === "project").length + 1).padStart(2, "0")} · OPENING`,
      title: "New project",
      year: "",
      role: "",
      summary: "",
      body: { type: "doc", content: [{ type: "paragraph", content: [] }] },
      assetIds: [],
      externalUrl: "",
      startNewPage: true,
    };
    updateContent((current) => ({ ...current, chapters: [...current.chapters, chapter] }));
    setActiveSection(id);
    setPanel("editor");
    setPreviewVersion(null);
  };

  const removeProject = () => {
    if (!selectedChapter || selectedChapter.section !== "project") return;
    if (!window.confirm(`Remove “${selectedChapter.title}” from the draft? Published versions are not affected.`)) return;
    const id = selectedChapter.id;
    updateContent((current) => ({ ...current, chapters: current.chapters.filter((chapter) => chapter.id !== id) }));
    setActiveSection("cover");
  };

  const toggleImage = (id: string) => {
    setPreviewVersion(null);
    if (activeSection === "cover") {
      changeProfile("coverAssetId", content.profile.coverAssetId === id ? "" : id);
      return;
    }
    if (!selectedChapter) return;
    changeChapter(selectedChapter.id, {
      assetIds: selectedChapter.assetIds.includes(id)
        ? selectedChapter.assetIds.filter((current) => current !== id)
        : [...selectedChapter.assetIds, id],
    });
  };

  const uploadImage = async (file: File, onProgress: (value: number) => void) => {
    const form = new FormData();
    form.set("file", file);
    const result = await new Promise<{ asset?: PortfolioAsset; error?: string }>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", "/api/admin/assets");
      request.withCredentials = true;
      request.setRequestHeader("Cache-Control", "no-store");
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      request.onerror = () => reject(new Error("Network error while uploading image."));
      request.onload = () => {
        try {
          const body = JSON.parse(request.responseText) as { asset?: PortfolioAsset; error?: string };
          if (request.status < 200 || request.status >= 300) reject(new Error(body.error ?? `Image upload returned ${request.status}.`));
          else resolve(body);
        } catch {
          reject(new Error("The image upload returned an invalid response."));
        }
      };
      request.send(form);
    });
    if (!result.asset) throw new Error(result.error ?? "Image upload failed.");
    setAssets((current) => [result.asset!, ...current]);
  };

  const updateAsset = async (id: string, values: { altText: string; caption: string; focusX: number; focusY: number }) => {
    const result = await updateAssetAction(id, values);
    if (!result.ok) throw new Error(result.error);
    setAssets((current) => current.map((asset) => asset.id === id ? { ...asset, ...values } : asset));
  };

  const removeAsset = async (id: string) => {
    if (!window.confirm("Remove this private image? Published images are protected.")) return;
    if (content.profile.coverAssetId === id || content.chapters.some((chapter) => chapter.assetIds.includes(id))) {
      updateContent((current) => ({
        ...current,
        profile: current.profile.coverAssetId === id ? { ...current.profile, coverAssetId: "" } : current.profile,
        chapters: current.chapters.map((chapter) => ({
          ...chapter,
          assetIds: chapter.assetIds.filter((imageId) => imageId !== id),
        })),
      }));
      const saved = await saveNow(true);
      if (!saved) {
        setError("The image was detached in the editor but its draft could not be saved. Resolve the save error before removing the file.");
        return;
      }
    }
    const result = await deleteAssetAction(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAssets((current) => current.filter((asset) => asset.id !== id));
  };

  const beginPublish = async () => {
    if (dirty && !(await saveNow())) {
      setError("The latest changes could not be saved. Resolve the save status before publishing.");
      return;
    }
    const summary = await publicationDiffAction();
    if (!summary.ok) {
      setError(summary.error);
      return;
    }
    setPublishDialog({ changes: summary.changes ?? [], revision: summary.revision ?? revisionRef.current });
    setDialogMessage("");
  };

  const confirmPublish = async () => {
    if (!publishDialog) return;
    setIsBusy(true);
    setDialogMessage("Preparing optimized image copies and publishing a snapshot…");
    const result = await publishDraftAction(publishDialog.revision);
    setIsBusy(false);
    if (!result.ok) {
      setDialogMessage(result.error);
      if (result.conflict) setRevisionConflict(true);
      return;
    }
    const publishedAt = result.publishedAt ? prettyDate(result.publishedAt) : "just now";
    setLatestNotice(`Version ${result.version} published at ${publishedAt}.`);
    setPublishDialog(null);
    router.refresh();
  };

  const reloadDraft = async () => {
    const result = await loadDraftAction();
    if (!result.ok || !result.content || !result.revision) {
      setError(result.ok ? "The latest draft could not be loaded." : result.error);
      return;
    }
    setContent(result.content);
    contentRef.current = result.content;
    setRevision(result.revision);
    revisionRef.current = result.revision;
    setDirty(false);
    setSaveState("saved");
    setSaveMessage("Latest saved draft loaded.");
    setRevisionConflict(false);
    setError("");
  };

  const restoreVersion = async (publication: PublicationRecord) => {
    if (!window.confirm(`Make version ${publication.version} public? Your current draft will remain unchanged.`)) return;
    setIsBusy(true);
    const result = await rollbackPublicationAction(publication.id);
    setIsBusy(false);
    if (!result.ok) setError(result.error);
    else {
      setLatestNotice(result.message ?? "The public version was restored.");
      router.refresh();
    }
  };

  const addContactLink = () => {
    if (!contactLinkDraft.label.trim() || !/^https:\/\/|^mailto:|^tel:/i.test(contactLinkDraft.url.trim())) {
      setError("Enter a link label and a secure https://, mailto:, or tel: URL.");
      return;
    }
    changeContact("links", [...content.contact.links, { id: crypto.randomUUID(), ...contactLinkDraft, label: contactLinkDraft.label.trim(), url: contactLinkDraft.url.trim() }]);
    setContactLinkDraft({ label: "", url: "" });
  };

  const onDragEnd = (event: DragEndEvent) => {
    if (event.over && event.active.id !== event.over.id) reorderChapter(String(event.active.id), String(event.over.id));
  };

  const activeTab = (section: Section) => {
    setActiveSection(section);
    setPanel("editor");
    setPreviewVersion(null);
    setError("");
  };

  const contentForPanel = () => {
    if (activeSection === "cover") {
      return (
        <>
          <div className="editor-section-heading"><span className="page-eyebrow">THE FIRST IMPRESSION</span><h1>Cover & identity</h1><p>These details are part of the unpublished draft until you publish.</p></div>
          <div className="editor-fields">
            <Field label="Your name" value={content.profile.name} maxLength={100} onChange={(value) => changeProfile("name", value)} />
            <Field label="Portfolio title" value={content.profile.bookTitle} maxLength={100} onChange={(value) => changeProfile("bookTitle", value)} />
            <Field label="Short descriptor" value={content.profile.descriptor} maxLength={150} onChange={(value) => changeProfile("descriptor", value)} />
            <Field label="Cover headline" value={content.profile.coverTitle} multiline maxLength={180} onChange={(value) => changeProfile("coverTitle", value)} />
            <Field label="Cover introduction" value={content.profile.coverIntro} multiline maxLength={500} onChange={(value) => changeProfile("coverIntro", value)} />
            <Field label="Year" value={content.profile.year} maxLength={20} onChange={(value) => changeProfile("year", value)} />
          </div>
          <ImageChooser assets={assets} selectedIds={selectedImages} onSelect={toggleImage} onOpenMedia={() => setPanel("media")} />
        </>
      );
    }
    if (activeSection === "contact") {
      return (
        <>
          <div className="editor-section-heading"><span className="page-eyebrow">THE LAST PAGE</span><h1>Contact details</h1><p>Visitors see these details only after they are published.</p></div>
          <div className="editor-fields">
            <Field label="Closing headline" value={content.contact.title} maxLength={150} onChange={(value) => changeContact("title", value)} />
            <Field label="Contact message" value={content.contact.message} multiline maxLength={600} onChange={(value) => changeContact("message", value)} />
            <Field label="Email address" value={content.contact.email} placeholder="hello@example.com" maxLength={254} onChange={(value) => changeContact("email", value)} />
          </div>
          <div className="contact-links-editor">
            <h2>External contact links</h2>
            {content.contact.links.map((link) => (
              <div className="contact-link-row" key={link.id}>
                <span>{link.label}</span><a href={link.url} target="_blank" rel="noreferrer">{link.url}</a>
                <button type="button" className="admin-danger-button" onClick={() => changeContact("links", content.contact.links.filter((item) => item.id !== link.id))}>REMOVE</button>
              </div>
            ))}
            <div className="contact-link-add">
              <input aria-label="Link label" placeholder="Label (e.g. LinkedIn)" value={contactLinkDraft.label} onChange={(event) => setContactLinkDraft((item) => ({ ...item, label: event.target.value }))} />
              <input aria-label="Link URL" placeholder="https://…" value={contactLinkDraft.url} onChange={(event) => setContactLinkDraft((item) => ({ ...item, url: event.target.value }))} />
              <button type="button" className="admin-secondary-button" onClick={addContactLink}>ADD LINK</button>
            </div>
          </div>
        </>
      );
    }
    if (!selectedChapter) return <div className="admin-empty">Choose or add a chapter.</div>;
    return (
      <>
        <div className="editor-section-heading">
          <span className="page-eyebrow">{selectedChapter.section === "about" ? "ABOUT" : "PROJECT CHAPTER"}</span>
          <h1>{selectedChapter.section === "about" ? "About you" : "Project details"}</h1>
          <p>Use the rich-text toolbar for headings, emphasis, lists, quotes, and links.</p>
        </div>
        <div className="editor-fields">
          <Field label="Chapter title" value={selectedChapter.title} maxLength={160} onChange={(value) => changeChapter(selectedChapter.id, { title: value })} />
          <Field label="Section label" value={selectedChapter.eyebrow} maxLength={100} onChange={(value) => changeChapter(selectedChapter.id, { eyebrow: value })} />
          {selectedChapter.section === "project" && (
            <>
              <Field label="Year" value={selectedChapter.year} maxLength={20} onChange={(value) => changeChapter(selectedChapter.id, { year: value })} />
              <Field label="Your role" value={selectedChapter.role} maxLength={120} onChange={(value) => changeChapter(selectedChapter.id, { role: value })} />
              <Field label="Short introduction" value={selectedChapter.summary} multiline maxLength={600} onChange={(value) => changeChapter(selectedChapter.id, { summary: value })} />
              <Field label="Related external link (https://, mailto:, or tel:)" value={selectedChapter.externalUrl} maxLength={1000} placeholder="https://…" onChange={(value) => changeChapter(selectedChapter.id, { externalUrl: value })} />
            </>
          )}
          <label className="admin-field"><span>Page style</span>
            <select value={selectedChapter.type} onChange={(event) => changeChapter(selectedChapter.id, { type: event.target.value as PageStyle })}>
              {pageStyles.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}
            </select>
          </label>
          <label className="admin-check-field">
            <input type="checkbox" checked={selectedChapter.startNewPage} onChange={(event) => changeChapter(selectedChapter.id, { startNewPage: event.target.checked })} />
            <span>Start this chapter on a new page</span>
          </label>
        </div>
        <section className="rich-editor-section">
          <h2>Chapter content</h2>
          <PageEditor
            key={selectedChapter.id}
            document={selectedChapter.body}
            onChange={(body) => changeChapter(selectedChapter.id, { body })}
          />
        </section>
        <ImageChooser assets={assets} selectedIds={selectedImages} onSelect={toggleImage} onOpenMedia={() => setPanel("media")} />
        {selectedChapter.section === "project" && <button type="button" className="admin-danger-button chapter-remove" onClick={removeProject}>REMOVE THIS PROJECT FROM DRAFT</button>}
      </>
    );
  };

  return (
    <main className="admin-app">
      <header className="admin-topbar">
        <a href="/" className="admin-topbar__brand">L<span>—</span>P <i>PRIVATE EDITOR</i></a>
        <div className="admin-topbar__status">
          <span className={`save-indicator save-indicator--${saveState}`} />
          <span>{saveMessage}</span>
        </div>
        <div className="admin-topbar__actions">
          <button type="button" className="admin-secondary-button" onClick={() => void saveNow()} disabled={saveState === "saving"}>SAVE NOW</button>
          <button type="button" className="admin-primary-button" onClick={() => void beginPublish()} disabled={isBusy || saveState === "conflict"}>REVIEW & PUBLISH <span>↗</span></button>
          <form action={signOutAction}><button className="admin-text-button" type="submit">SIGN OUT</button></form>
        </div>
      </header>

      {(error || revisionConflict) && (
        <div className="admin-alert admin-alert--error admin-global-alert" role="alert">
          <span>{revisionConflict ? "This draft changed in another editor session. Your current text is still on screen; reload the latest saved draft before continuing." : error}</span>
          {revisionConflict && <button type="button" className="admin-secondary-button" onClick={() => void reloadDraft()}>RELOAD LATEST DRAFT</button>}
          {!revisionConflict && <button type="button" aria-label="Dismiss message" onClick={() => setError("")}>×</button>}
        </div>
      )}
      {latestNotice && <div className="admin-alert admin-latest-notice" role="status">{latestNotice}<button type="button" aria-label="Dismiss publication notice" onClick={() => setLatestNotice("")}>×</button></div>}

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-sidebar__caption">YOUR PORTFOLIO</div>
          <nav className="admin-nav" aria-label="Portfolio sections">
            <button type="button" className={`admin-nav__fixed ${activeSection === "cover" ? "is-current" : ""}`} onClick={() => activeTab("cover")}><span>▱</span> Cover & identity</button>
            <div className="admin-nav__section-heading"><span>ABOUT & PROJECTS</span><button type="button" onClick={addProject} aria-label="Add project">+</button></div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={content.chapters.map((chapter) => chapter.id)} strategy={verticalListSortingStrategy}>
                {content.chapters.map((chapter, index) => (
                  <SortableChapter key={chapter.id} chapter={chapter} selected={activeSection === chapter.id} onSelect={() => activeTab(chapter.id)} onMove={(direction) => moveChapter(chapter.id, direction)} />
                ))}
              </SortableContext>
            </DndContext>
            {!content.chapters.some((chapter) => chapter.section === "about") && <div className="admin-alert admin-alert--error">Add an About chapter to introduce yourself.</div>}
            <button type="button" className={`admin-nav__fixed ${activeSection === "contact" ? "is-current" : ""}`} onClick={() => activeTab("contact")}><span>↗</span> Contact details</button>
          </nav>
          <div className="admin-sidebar__bottom">
            <button type="button" className={panel === "media" ? "is-selected" : ""} onClick={() => { setPanel("media"); setPreviewVersion(null); }}>▧ Image library <span>{assets.length}</span></button>
            <button type="button" className={panel === "versions" ? "is-selected" : ""} onClick={() => { setPanel("versions"); setPreviewVersion(null); }}>◷ Publication history <span>{publications.length}</span></button>
            <p>Private draft · {revisionConflict ? "conflict detected" : `revision ${revision}`}</p>
          </div>
        </aside>

        <section className="admin-workspace">
          {panel === "editor" ? (
            <div className="admin-editor-scroll">
              <div className="admin-panel-switch">
                <button className="is-selected" type="button">CONTENT</button>
                <button type="button" onClick={() => setPanel("media")}>MEDIA</button>
              </div>
              {contentForPanel()}
              <div className="admin-editor__bottom">
                <span>{dirty ? "Changes are private until published." : "Your changes are saved privately."}</span>
                <button type="button" className="admin-primary-button" onClick={() => void saveNow()}>SAVE DRAFT</button>
              </div>
            </div>
          ) : panel === "media" ? (
            <div className="admin-editor-scroll">
              <div className="admin-section-title"><span className="page-eyebrow">PRIVATE SOURCE IMAGES</span><h1>Image library</h1><p>Select an image here to attach it to your current cover or chapter.</p><button type="button" className="admin-secondary-button" onClick={() => setPanel("editor")}>← BACK TO CONTENT</button></div>
              <MediaPanel
                assets={assets}
                selectedIds={selectedImages}
                multiple={activeSection !== "cover"}
                onSelect={toggleImage}
                onUpload={uploadImage}
                onUpdate={updateAsset}
                onDelete={removeAsset}
                busy={isBusy}
              />
            </div>
          ) : (
            <div className="admin-editor-scroll">
              <div className="admin-section-title"><span className="page-eyebrow">IMMUTABLE SNAPSHOTS</span><h1>Publication history</h1><p>Restoring a version changes what is public; it does not replace your editable draft.</p></div>
              {publications.length === 0 ? (
                <div className="admin-empty">Nothing has been published yet. Your draft stays private until you review and publish it.</div>
              ) : (
                <div className="version-list">
                  {publications.map((publication) => (
                    <article className={`version-card ${publication.current ? "version-card--current" : ""}`} key={publication.id}>
                      <div><span className="page-eyebrow">VERSION {String(publication.version).padStart(2, "0")}{publication.current ? " · PUBLIC" : ""}</span><strong>{prettyDate(publication.createdAt)}</strong></div>
                      <div className="version-card__actions">
                        <button type="button" className="admin-secondary-button" onClick={() => { setPreviewVersion(publication); setPanel("editor"); setActiveSection("cover"); }}>PREVIEW SNAPSHOT</button>
                        {!publication.current && <button type="button" className="admin-primary-button" disabled={isBusy} onClick={() => void restoreVersion(publication)}>SET PUBLIC</button>}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <aside className={`admin-preview-pane admin-preview-pane--${previewMode}`}>
          <div className="admin-preview-pane__head">
            <div><span className="page-eyebrow">PRIVATE PREVIEW</span><strong>{previewVersion ? `VERSION ${previewVersion.version}` : "CURRENT DRAFT"}</strong></div>
            <div className="admin-preview-pane__modes">
              <button type="button" aria-label="Desktop preview" aria-pressed={previewMode === "desktop"} onClick={() => setPreviewMode("desktop")}>▰</button>
              <button type="button" aria-label="Mobile preview" aria-pressed={previewMode === "mobile"} onClick={() => setPreviewMode("mobile")}>▯</button>
            </div>
          </div>
          <div className="admin-preview-pane__canvas">
            <Preview
              content={currentPreviewContent}
              chapter={activeSection === "cover" || activeSection === "contact" ? undefined : currentPreviewChapter}
              contact={activeSection === "contact"}
              assets={imagesForPreview}
              mode={previewMode}
              onOverflowChange={setPreviewOverflow}
            />
          </div>
          {previewOverflow && <p className="admin-preview-overflow" role="status">This page extends beyond the preview area. Scroll the preview to inspect all content; the published page remains scrollable.</p>}
          {previewVersion && <div className="preview-version-note">Read-only snapshot preview. Your draft has not changed.<button type="button" onClick={() => setPreviewVersion(null)}>RETURN TO DRAFT</button></div>}
          <div className="admin-preview-pane__footer"><span>THIS VIEW IS PRIVATE</span><span>CHANGES ARE NOT PUBLIC UNTIL PUBLISHED</span></div>
        </aside>
      </div>

      {publishDialog && (
        <div className="modal-backdrop admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isBusy) setPublishDialog(null); }}>
          <section className="admin-publish-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title">
            <button className="dialog-close" type="button" aria-label="Close publish review" disabled={isBusy} onClick={() => setPublishDialog(null)}>×</button>
            <span className="page-eyebrow">CHECK YOUR CHANGES</span>
            <h2 id="publish-title">Ready to publish?</h2>
            <p>This creates an immutable snapshot and switches the public portfolio to it. Visitors already reading keep their loaded version.</p>
            <ul>{publishDialog.changes.map((change, index) => <li key={`${change}-${index}`}>{change}</li>)}</ul>
            {previewOverflow && <p className="admin-alert admin-alert--warning" role="status">The selected preview extends beyond the available page area. Review it before publishing; longer content can be scrolled by readers.</p>}
            {dialogMessage && <p className={`admin-alert ${dialogMessage.includes("published at") ? "" : "admin-alert--error"}`} role="status">{dialogMessage}</p>}
            <div className="admin-dialog-actions">
              <button type="button" className="admin-secondary-button" disabled={isBusy} onClick={() => setPublishDialog(null)}>KEEP EDITING</button>
              <button type="button" className="admin-primary-button" disabled={isBusy || dialogMessage.includes("published at")} onClick={() => void confirmPublish()}>{isBusy ? "PUBLISHING…" : "PUBLISH SNAPSHOT"} <span>↗</span></button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function ImageChooser({
  assets,
  selectedIds,
  onSelect,
  onOpenMedia,
}: {
  assets: PortfolioAsset[];
  selectedIds: string[];
  onSelect: (id: string) => void;
  onOpenMedia: () => void;
}) {
  return (
    <section className="image-chooser">
      <div className="image-chooser__heading"><h2>Images on this page</h2><button type="button" onClick={onOpenMedia}>Open image library</button></div>
      {!assets.length ? <p>No image assets yet. Use the Image library to upload a file.</p> : (
        <div className="image-chooser__grid">
          {assets.map((asset) => (
            <button key={asset.id} type="button" className={selectedIds.includes(asset.id) ? "is-selected" : ""} onClick={() => onSelect(asset.id)} aria-pressed={selectedIds.includes(asset.id)}>
              {asset.signedUrl ? <img src={asset.signedUrl} alt="" /> : <span>NO PREVIEW</span>}
              <span>{selectedIds.includes(asset.id) ? "✓ " : ""}{asset.originalName}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
