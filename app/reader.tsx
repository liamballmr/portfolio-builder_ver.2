"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { RichText } from "@/lib/rich-text";
import type { PageStyle, PortfolioContent, RichTextNode } from "@/lib/portfolio";

type BookImage = {
  src: string;
  altText: string;
  caption: string;
  focusX: number;
  focusY: number;
};

type BookPage = {
  id: string;
  kind: "cover" | "contents" | "chapter" | "contact";
  eyebrow: string;
  title: string;
  intro: string;
  body?: RichTextNode;
  name?: string;
  bookTitle?: string;
  descriptor?: string;
  year?: string;
  role?: string;
  section?: string;
  style?: PageStyle;
  email?: string;
  links?: Array<{ id: string; label: string; url: string }>;
  note?: string;
  assets: BookImage[];
  chapters?: Array<PortfolioContent["chapters"][number] & { thumbnail?: BookImage }>;
};

function safeExternalUrl(value: string): boolean {
  return /^(https:\/\/|mailto:|tel:)/i.test(value.trim());
}

function videoEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
    }
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
    }
    if (host === "vimeo.com") {
      const id = url.pathname.match(/^\/(\d+)(?:\/|$)/)?.[1];
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
    return null;
  } catch {
    return null;
  }
}

function createBookPages(content: PortfolioContent): BookPage[] {
  const asset = (id: string): BookImage | undefined => {
    const image = content.publishedAssets?.[id];
    if (!image?.path) return undefined;
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!base) return undefined;
    return {
      src: `${base.replace(/\/$/, "")}/storage/v1/object/public/portfolio-published/${image.path.split("/").map(encodeURIComponent).join("/")}`,
      altText: image.altText,
      caption: image.caption,
      focusX: image.focusX,
      focusY: image.focusY,
    };
  };

  const coverAsset = content.profile.coverAssetId ? asset(content.profile.coverAssetId) : undefined;
  const chapters = content.chapters.map((chapter) => ({
    id: chapter.id,
    kind: "chapter" as const,
    eyebrow: chapter.eyebrow,
    title: chapter.title,
    intro: chapter.summary,
    body: chapter.body,
    role: chapter.role,
    year: chapter.year,
    section: chapter.section,
    style: chapter.type,
    note: chapter.externalUrl,
    assets: chapter.assetIds.map(asset).filter((image): image is BookImage => Boolean(image)),
  }));

  return [
    {
      id: "cover",
      kind: "cover",
      eyebrow: content.profile.bookTitle.toUpperCase(),
      title: content.profile.coverTitle,
      intro: content.profile.coverIntro,
      name: content.profile.name,
      bookTitle: content.profile.bookTitle,
      descriptor: content.profile.descriptor,
      year: content.profile.year,
      assets: coverAsset ? [coverAsset] : [],
    },
    {
      id: "contents",
      kind: "contents",
      eyebrow: "IN THIS BOOK",
      title: "A small guide.",
      intro: "Choose a chapter to go straight to it.",
      chapters: content.chapters.map((chapter) => ({
        ...chapter,
        thumbnail: chapter.assetIds.map(asset).find((image): image is BookImage => Boolean(image)),
      })),
      assets: [],
    },
    ...chapters,
    {
      id: "contact",
      kind: "contact",
      eyebrow: "A NOTE BEFORE YOU GO",
      title: content.contact.title,
      intro: content.contact.message,
      email: content.contact.email,
      links: content.contact.links,
      assets: [],
    },
  ];
}

function Artwork({ image, onOpen, full = false }: { image: BookImage; onOpen: (image: BookImage) => void; full?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <button
      className={`artwork artwork--uploaded ${full ? "artwork--full" : ""}`}
      type="button"
      onClick={() => {
        if (failed) {
          setFailed(false);
          setAttempt((value) => value + 1);
        } else onOpen(image);
      }}
      aria-label={`Open image: ${image.altText || "portfolio image"}`}
    >
      {failed
        ? <span className="artwork__failure">Image failed to load. Select to retry.</span>
        : <img
          key={attempt}
          src={image.src}
          alt={image.altText}
          loading="lazy"
          onError={() => setFailed(true)}
          onLoad={() => setFailed(false)}
          style={{ objectPosition: `${image.focusX}% ${image.focusY}%` }}
        />}
      <span className="artwork__zoom">VIEW IMAGE ↗</span>
      {image.caption && <span className="artwork__caption">{image.caption}</span>}
    </button>
  );
}

function ImageViewport({
  image,
  zoom,
  setZoom,
}: {
  image: BookImage;
  zoom: number;
  setZoom: (value: number) => void;
}) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  useEffect(() => {
    if (zoom === 1) setPan({ x: 0, y: 0 });
  }, [zoom]);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    if (points.length >= 2) {
      pinch.current = { distance: distance(points[0], points[1]), zoom };
      drag.current = null;
    } else {
      drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    }
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    if (points.length >= 2 && pinch.current) {
      setZoom(Math.max(1, Math.min(4, pinch.current.zoom * distance(points[0], points[1]) / Math.max(1, pinch.current.distance))));
    } else if (zoom > 1 && drag.current) {
      setPan({
        x: drag.current.panX + event.clientX - drag.current.x,
        y: drag.current.panY + event.clientY - drag.current.y,
      });
    }
  };
  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };
  return (
    <div
      className="image-dialog__visual"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onWheel={(event) => {
        event.preventDefault();
        setZoom(Math.max(1, Math.min(4, zoom + (event.deltaY < 0 ? 0.15 : -0.15))));
      }}
    >
      <img
        key={attempt}
        src={image.src}
        alt={image.altText}
        draggable={false}
        onLoad={() => setFailed(false)}
        onError={() => setFailed(true)}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          objectPosition: `${image.focusX}% ${image.focusY}%`,
        }}
      />
      {failed && <button className="image-viewer-retry" type="button" onClick={() => {
        setFailed(false);
        setAttempt((value) => value + 1);
      }}>Image could not be loaded. Retry</button>}
    </div>
  );
}

function VideoEmbed({ url, title }: { url: string; title: string }) {
  const [started, setStarted] = useState(false);
  const embedUrl = videoEmbedUrl(url);
  if (!embedUrl) return <a className="video-link" href={url} target="_blank" rel="noreferrer">Watch video ↗</a>;
  return (
    <div className="video-embed">
      {started
        ? <iframe
          src={embedUrl}
          title={title}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
        : <button type="button" onClick={() => setStarted(true)}>Load video: {title}</button>}
    </div>
  );
}

function PageContent({
  page,
  index,
  onOpenImage,
  onChapter,
}: {
  page: BookPage;
  index: number;
  onOpenImage: (image: BookImage) => void;
  onChapter: (index: number) => void;
}) {
  if (page.kind === "cover") {
    return (
      <div className="cover-content">
        <span className="page-eyebrow">{page.eyebrow}</span>
        <div className="cover-content__main">
          <p className="cover-content__name">{page.name} <span>—</span> {page.bookTitle}</p>
          <h1>{page.title.split("\n").map((line) => <span key={line}>{line}</span>)}</h1>
          <p className="cover-content__intro">{page.intro}</p>
          {page.assets[0] && <Artwork image={page.assets[0]} onOpen={onOpenImage} />}
        </div>
        <div className="cover-content__bottom">
          <button className="text-button" type="button" onClick={() => onChapter(1)}>START READING <span>↗</span></button>
          <span className="cover-content__edition">{page.descriptor} · {page.year}</span>
        </div>
        <span className="cover-decoration" aria-hidden="true"><i /><i /><i /></span>
      </div>
    );
  }

  if (page.kind === "contents") {
    return (
      <div className="page-content contents-content">
        <span className="page-eyebrow">{page.eyebrow}</span>
        <h2>{page.title}</h2>
        <p className="page-lede">{page.intro}</p>
        <ol className="contents-list">
          {page.chapters?.map((chapter, chapterIndex) => (
            <li key={chapter.id}>
              <button type="button" onClick={() => onChapter(chapterIndex + 2)}>
                {chapter.thumbnail
                  ? <img className="contents-list__thumb" src={chapter.thumbnail.src} alt="" loading="lazy" />
                  : <span className="contents-list__number">{String(chapterIndex + 1).padStart(2, "0")}</span>}
                <span>{chapter.title}</span>
                <span className="contents-list__arrow">↗</span>
              </button>
            </li>
          ))}
          <li><button type="button" onClick={() => onChapter((page.chapters?.length ?? 0) + 2)}><span className="contents-list__number">✦</span><span>Get in touch</span><span className="contents-list__arrow">↗</span></button></li>
        </ol>
      </div>
    );
  }

  return (
    <article className="page-content">
      <span className="page-eyebrow">{page.eyebrow}</span>
      <h2>{page.title.split("\n").map((line) => <span key={line}>{line}</span>)}</h2>
      {page.section === "project" && page.kind === "chapter" && <p className="public-page-meta">{page.year} · {page.role}</p>}
      <div className={`page-body ${page.assets.length ? "page-body--with-art" : ""} ${page.kind === "contact" ? "page-body--contact" : ""} ${page.style ? `page-body--${page.style}` : ""}`}>
        <div className="page-copy">
          {page.intro && <p>{page.intro}</p>}
          {page.body && <RichText document={page.body} />}
          {page.kind === "contact" && page.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(page.email) && <p><a href={`mailto:${page.email}`}>{page.email}</a></p>}
          {page.kind === "contact" && page.links?.filter((link) => safeExternalUrl(link.url)).map((link) => <p key={link.id}><a href={link.url} target={link.url.startsWith("https://") ? "_blank" : undefined} rel="noreferrer">{link.label} ↗</a></p>)}
          {page.kind === "chapter" && page.note && safeExternalUrl(page.note) && page.style !== "video" && <p><a href={page.note} target={page.note.startsWith("https://") ? "_blank" : undefined} rel="noreferrer">View related work ↗</a></p>}
        </div>
        {page.kind === "chapter" && page.style === "video" && page.note && safeExternalUrl(page.note) && <VideoEmbed url={page.note} title={page.title} />}
        {page.assets.map((image) => <Artwork key={`${page.id}-${image.src}`} image={image} onOpen={onOpenImage} full={page.style === "full-image" || page.assets.length === 1} />)}
      </div>
    </article>
  );
}

export default function PortfolioReader({ content, demo = false }: { content: PortfolioContent; demo?: boolean }) {
  const pages = useMemo(() => createBookPages(content), [content]);
  const [current, setCurrent] = useState(0);
  const [wide, setWide] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [activeImage, setActiveImage] = useState<BookImage | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [continuous, setContinuous] = useState(false);
  const [fontSize, setFontSize] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const [announcement, setAnnouncement] = useState("Cover");
  const [cornerDrag, setCornerDrag] = useState<{ direction: "next" | "previous"; deltaX: number } | null>(null);
  const [readingPositionReady, setReadingPositionReady] = useState(false);
  const bookRef = useRef<HTMLElement>(null);
  const contentsDialogRef = useRef<HTMLElement>(null);
  const imageDialogRef = useRef<HTMLElement>(null);
  const cornerGesture = useRef<{ pointerId: number; direction: "next" | "previous"; startX: number; deltaX: number } | null>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px) and (min-height: 640px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    window.addEventListener("resize", update);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(motion.matches);
    const updateMotion = () => setReduceMotion(motion.matches);
    motion.addEventListener("change", updateMotion);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      motion.removeEventListener("change", updateMotion);
    };
  }, []);

  useEffect(() => {
    setCurrent((value) => Math.min(value, pages.length - 1));
  }, [pages.length]);

  useEffect(() => {
    try {
      const savedPageId = window.localStorage.getItem("portfolio-reading-page");
      if (savedPageId) {
        const savedIndex = pages.findIndex((page) => page.id === savedPageId);
        if (savedIndex >= 0) setCurrent(savedIndex);
      }
    } catch (error) {
      console.warn("Reading position could not be restored from this browser:", error);
    }
    setReadingPositionReady(true);
  }, [pages]);

  useEffect(() => {
    if (!readingPositionReady) return;
    try {
      window.localStorage.setItem("portfolio-reading-page", pages[current]?.id ?? "cover");
    } catch (error) {
      console.warn("Reading position could not be saved in this browser:", error);
    }
  }, [current, pages, readingPositionReady]);

  const openImage = useCallback((image: BookImage) => {
    setActiveImage(image);
    setImageZoom(1);
  }, []);

  const navigate = useCallback((target: number) => {
    const bounded = Math.max(0, Math.min(pages.length - 1, target));
    setCurrent(bounded);
    setAnnouncement(`${pages[bounded].eyebrow}, page ${bounded + 1} of ${pages.length}`);
    setHintVisible(false);
  }, [pages]);

  const next = useCallback(() => {
    if (current === 0) navigate(1);
    else if (current >= pages.length - 1) return;
    else if (wide) navigate(current === pages.length - 2 ? pages.length - 1 : current + 2);
    else navigate(current + 1);
  }, [current, navigate, wide]);

  const previous = useCallback(() => {
    if (current === 0) return;
    if (wide && current === pages.length - 1) navigate(current - 2);
    else if (wide && current > 1) navigate(current - 2);
    else navigate(current - 1);
  }, [current, navigate, wide]);

  const startCornerDrag = (event: PointerEvent<HTMLButtonElement>, direction: "next" | "previous") => {
    if (event.button !== 0 || (direction === "next" && current >= pages.length - 1) || (direction === "previous" && current === 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cornerGesture.current = { pointerId: event.pointerId, direction, startX: event.clientX, deltaX: 0 };
    setCornerDrag({ direction, deltaX: 0 });
  };

  const moveCornerDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = cornerGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const distance = event.clientX - gesture.startX;
    const deltaX = gesture.direction === "next" ? Math.min(0, distance) : Math.max(0, distance);
    gesture.deltaX = deltaX;
    setCornerDrag({ direction: gesture.direction, deltaX });
  };

  const endCornerDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = cornerGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    cornerGesture.current = null;
    setCornerDrag(null);
    if (Math.abs(gesture.deltaX) >= 64) {
      if (gesture.direction === "next") next();
      else previous();
    }
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContentsOpen(false);
        setActiveImage(null);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!bookRef.current?.contains(document.activeElement)) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        previous();
      } else if (event.key === "Home") {
        event.preventDefault();
        navigate(0);
      } else if (event.key === "End") {
        event.preventDefault();
        navigate(pages.length - 1);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [navigate, next, previous]);

  useEffect(() => {
    const dialog = contentsOpen ? contentsDialogRef.current : activeImage ? imageDialogRef.current : null;
    if (!dialog) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not(:disabled), a[href], select, input, textarea, [tabindex]:not([tabindex='-1'])",
    ));
    focusable[0]?.focus();

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("keydown", trapFocus);
    return () => {
      dialog.removeEventListener("keydown", trapFocus);
      previousFocus?.focus();
    };
  }, [contentsOpen, activeImage]);

  const pageIndices = wide && current > 0 && current < pages.length - 1
    ? [current, Math.min(current + 1, pages.length - 2)]
    : [current];
  const isSpread = wide && current > 0 && current < pages.length - 1;
  const tocChapters = pages.find((page) => page.kind === "contents")?.chapters ?? [];

  return (
    <main className={`portfolio ${reduceMotion ? "portfolio--reduced-motion" : ""} ${fontSize > 0 ? "portfolio--large-reading" : ""}`} style={{ "--reading-size": `${18 + fontSize * 2}px` } as React.CSSProperties}>
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Liam portfolio home">L<span>—</span>P</a>
        <span className="topbar__title">{content.profile.bookTitle.toUpperCase()}</span>
        <a className="topbar__admin" href="/admin">EDITOR ACCESS <span>↗</span></a>
      </header>
      {demo && <div className="demo-banner">DEMO ONLY · Configure your private editor and publish your real content from <a href="/admin">/admin</a>.</div>}

      <section className="reader" aria-label="Portfolio book">
        <div className="reader__heading">
          <span>{content.profile.name.toUpperCase()} <i>·</i> {content.profile.year}</span>
          <span className="reader__hint">{wide ? "A book to read slowly" : "A collection to explore"}</span>
        </div>

        {!continuous ? (
          <div           className={`book-stage ${isSpread ? "book-stage--spread" : ""}`}>
            <button className="page-turn page-turn--previous" type="button" onClick={previous} disabled={current === 0} aria-label="Previous page">
              <span>←</span>
            </button>
            <section
              ref={bookRef}
              className={`book ${isSpread ? "book--spread" : "book--single"}`}
              tabIndex={0}
              aria-label="Reading area. Use left and right arrow keys to turn pages."
            >
              {pageIndices.map((index, slot) => (
                <div
                  className={`book-page ${index === 0 || index === pages.length - 1 ? "book-page--cover" : ""} ${slot === 1 ? "book-page--right" : ""}`}
                  key={`${index}-${current}`}
                  style={{
                    animationDuration: reduceMotion ? "0ms" : `${wide ? 450 : 300}ms`,
                    ...(cornerDrag && !reduceMotion && (!isSpread || cornerDrag.direction === (slot === 1 ? "next" : "previous"))
                      ? {
                        transform: `rotateY(${Math.max(-24, Math.min(24, cornerDrag.deltaX / 5))}deg)`,
                        transformOrigin: cornerDrag.direction === "next" ? "right bottom" : "left bottom",
                      }
                      : {}),
                  }}
                >
                  <PageContent
                    page={pages[index]}
                    index={index}
                    onOpenImage={openImage}
                    onChapter={navigate}
                  />
                  {(isSpread ? [slot === 1 ? "next" : "previous"] : ["previous", "next"])
                    .filter((direction) => direction === "next" ? current < pages.length - 1 : current > 0)
                    .map((direction) => (
                      <button
                        key={direction}
                        className={`page-corner page-corner--${direction}`}
                        type="button"
                        aria-label={`Drag lower page corner to turn ${direction === "next" ? "forward" : "back"}`}
                        onPointerDown={(event) => startCornerDrag(event, direction === "next" ? "next" : "previous")}
                        onPointerMove={moveCornerDrag}
                        onPointerUp={endCornerDrag}
                        onPointerCancel={endCornerDrag}
                      />
                    ))}
                  <span className="book-page__number">{index === 0 || index === pages.length - 1 ? "L—P" : String(index).padStart(2, "0")}</span>
                </div>
              ))}
            </section>
            <button className="page-turn page-turn--next" type="button" onClick={next} disabled={current === pages.length - 1} aria-label="Next page">
              <span>→</span>
            </button>
          </div>
        ) : (
          <section className="continuous-reader" aria-label="Continuous reading">
            {pages.map((page, index) => (
              <div className="continuous-reader__page" key={page.eyebrow} id={`reading-${index}`}>
                <PageContent page={page} index={index} onOpenImage={openImage} onChapter={(target) => {
                  navigate(target);
                  document.getElementById(`reading-${target}`)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
                }} />
                <span className="book-page__number">{String(index + 1).padStart(2, "0")}</span>
              </div>
            ))}
          </section>
        )}

        {hintVisible && !continuous && (
          <p className="reader-hint" role="status">
            <span>↔</span> Use the arrows to explore. Your reading position is remembered on this device.
            <button type="button" onClick={() => setHintVisible(false)} aria-label="Dismiss reading hint">×</button>
          </p>
        )}

        {!continuous && (
          <div
            className="mobile-page-swipe"
            role="region"
            aria-label="Swipe here to turn pages"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              touchStartX.current = event.clientX;
            }}
            onPointerUp={(event) => {
              if (touchStartX.current === null) return;
              const distance = event.clientX - touchStartX.current;
              touchStartX.current = null;
              if (Math.abs(distance) > 48) {
                if (distance < 0) next();
                else previous();
              }
            }}
            onPointerCancel={() => { touchStartX.current = null; }}
          >
            <span>SWIPE HERE TO TURN PAGES</span>
          </div>
        )}

        <nav className="reader-controls" aria-label="Reading controls">
          <button className="control-button" type="button" onClick={() => setContentsOpen(true)} aria-label="Open table of contents">
            <span className="control-button__icon">☰</span><span>CONTENTS</span>
          </button>
          <div className="reader-controls__paging">
            <button className="round-button" type="button" onClick={previous} disabled={current === 0} aria-label="Previous page">←</button>
            <span className="progress-label">{String(current + 1).padStart(2, "0")} <i>/</i> {String(pages.length).padStart(2, "0")}</span>
            <button className="round-button" type="button" onClick={next} disabled={current === pages.length - 1} aria-label="Next page">→</button>
          </div>
          <div className="reader-controls__tools">
            <label className="font-setting">
              <span className="sr-only">Reading text size</span>
              <select value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} aria-label="Reading text size">
                <option value={0}>Aa</option>
                <option value={1}>Aa+</option>
                <option value={2}>Aa++</option>
              </select>
            </label>
            <button className={`control-button control-button--quiet ${continuous ? "is-active" : ""}`} type="button" onClick={() => setContinuous(!continuous)}>
              <span className="control-button__icon">≋</span><span>{continuous ? "BOOK VIEW" : "CONTINUOUS"}</span>
            </button>
            <button className={`control-button control-button--quiet ${reduceMotion ? "is-active" : ""}`} type="button" onClick={() => setReduceMotion(!reduceMotion)} aria-pressed={reduceMotion}>
              <span className="control-button__icon">◌</span><span>REDUCED MOTION</span>
            </button>
          </div>
        </nav>
        <p className="reader__footnote">{content.profile.name.toUpperCase()} <span>·</span> A PORTFOLIO BOOK</p>
        <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      </section>

      {contentsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setContentsOpen(false);
        }}>
          <section ref={contentsDialogRef} className="contents-dialog" role="dialog" aria-modal="true" aria-labelledby="contents-title">
            <button className="dialog-close" type="button" onClick={() => setContentsOpen(false)} aria-label="Close contents">×</button>
            <span className="page-eyebrow">TURN TO A CHAPTER</span>
            <h2 id="contents-title">Contents</h2>
            <ol className="contents-list contents-list--dialog">
              <li><button type="button" onClick={() => { navigate(0); setContentsOpen(false); }}><span className="contents-list__number">00</span><span>Cover</span><span className="contents-list__arrow">↗</span></button></li>
              {tocChapters.map((chapter, index) => (
                <li key={chapter.id}><button type="button" onClick={() => { navigate(index + 2); setContentsOpen(false); }}>
                  {chapter.thumbnail
                    ? <img className="contents-list__thumb" src={chapter.thumbnail.src} alt="" loading="lazy" />
                    : <span className="contents-list__number">{String(index + 1).padStart(2, "0")}</span>}
                  <span>{chapter.title}</span><span className="contents-list__arrow">↗</span>
                </button></li>
              ))}
              <li><button type="button" onClick={() => { navigate(content.chapters.length + 2); setContentsOpen(false); }}><span className="contents-list__number">✦</span><span>Get in touch</span><span className="contents-list__arrow">↗</span></button></li>
            </ol>
            <p className="dialog-note">Choosing a chapter turns directly to its opening page.</p>
          </section>
        </div>
      )}

      {activeImage && (
        <div className="modal-backdrop modal-backdrop--dark" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setActiveImage(null);
        }}>
          <section ref={imageDialogRef} className="image-dialog" role="dialog" aria-modal="true" aria-label="Portfolio image viewer">
            <button className="dialog-close dialog-close--light" type="button" onClick={() => setActiveImage(null)} aria-label="Close image">×</button>
            <ImageViewport image={activeImage} zoom={imageZoom} setZoom={setImageZoom} />
            <div className="image-dialog__controls">
              <button type="button" onClick={() => setImageZoom((value) => Math.max(1, value - 0.25))} aria-label="Zoom out">−</button>
              <button type="button" onClick={() => setImageZoom(1)} aria-label="Reset zoom">RESET</button>
              <button type="button" onClick={() => setImageZoom((value) => Math.min(3, value + 0.25))} aria-label="Zoom in">+</button>
            </div>
            <p>{activeImage.caption || activeImage.altText}</p>
          </section>
        </div>
      )}
    </main>
  );
}
