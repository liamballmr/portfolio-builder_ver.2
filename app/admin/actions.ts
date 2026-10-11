"use server";

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  collectAssetIds,
  isPortfolioContent,
  type PortfolioContent,
} from "@/lib/portfolio";
import {
  configuredAdminEmail,
  createSupabaseServerClient,
  requireAdmin,
} from "@/lib/supabase/server";

const SITE_ID = "00000000-0000-4000-8000-000000000001";

export type ActionResult = { ok: true; revision?: number; message?: string } | { ok: false; error: string; conflict?: boolean };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed. Please try again.";
}

export async function signInAction(_previous: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  try {
    if (email !== configuredAdminEmail()) return { error: "This account is not authorized to edit this portfolio." };
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: "Sign-in failed. Check the email and password, then try again." };
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || data.user?.email?.toLowerCase() !== configuredAdminEmail()) {
      await supabase.auth.signOut();
      return { error: "This account is not authorized to edit this portfolio." };
    }
    const { data: site, error: siteError } = await supabase.from("portfolio_sites")
      .select("id")
      .eq("id", SITE_ID)
      .single();
    if (siteError || !site) {
      await supabase.auth.signOut();
      console.error("Portfolio owner setup is incomplete:", siteError?.message);
      return { error: "The editor account is not assigned to this portfolio yet. Complete the owner setup in Supabase." };
    }
  } catch (error) {
    console.error("Portfolio sign-in failed:", error);
    return { error: errorMessage(error) };
  }

  redirect("/admin");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(`Unable to verify the session before signing out: ${userError.message}`);
  if (!data.user) redirect("/admin");
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(`Unable to sign out: ${error.message}`);
  redirect("/admin");
}

export async function saveDraftAction(
  content: PortfolioContent,
  expectedRevision: number,
): Promise<ActionResult> {
  if (!isPortfolioContent(content) || JSON.stringify(content).length > 1_000_000) {
    return { ok: false, error: "The draft is invalid or exceeds the 1 MB content limit." };
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return { ok: false, error: "Draft revision is invalid. Reload the editor before saving." };
  }
  try {
    const { supabase } = await requireAdmin();
    const { data, error } = await supabase.rpc("save_portfolio_draft", {
      p_expected_revision: expectedRevision,
      p_content: content,
    });
    if (error) {
      return {
        ok: false,
        error: error.message,
        conflict: error.code === "40001",
      };
    }
    revalidatePath("/admin");
    if (typeof data !== "number") return { ok: false, error: "The draft save did not return a revision number." };
    return { ok: true, revision: data, message: "Draft saved." };
  } catch (error) {
    console.error("Portfolio draft save failed:", error);
    return { ok: false, error: errorMessage(error) };
  }
}

export async function updateAssetAction(
  assetId: string,
  values: { altText: string; caption: string; focusX: number; focusY: number },
): Promise<ActionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return { ok: false, error: "Invalid image identifier." };
  if (
    typeof values.altText !== "string" ||
    values.altText.trim().length > 500 ||
    typeof values.caption !== "string" ||
    values.caption.trim().length > 500 ||
    !Number.isFinite(values.focusX) || values.focusX < 0 || values.focusX > 100 ||
    !Number.isFinite(values.focusY) || values.focusY < 0 || values.focusY > 100
  ) return { ok: false, error: "Image details are invalid." };
  try {
    const { supabase } = await requireAdmin();
    const { data, error } = await supabase.from("portfolio_assets").update({
      alt_text: values.altText.trim(),
      caption: values.caption.trim(),
      focus_x: values.focusX,
      focus_y: values.focusY,
    }).eq("id", assetId).eq("site_id", SITE_ID).select("id").maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Image not found or not editable by this account." };
    revalidatePath("/admin");
    return { ok: true, message: "Image details saved." };
  } catch (error) {
    console.error("Portfolio image metadata update failed:", error);
    return { ok: false, error: errorMessage(error) };
  }
}

export async function deleteAssetAction(assetId: string): Promise<ActionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return { ok: false, error: "Invalid image identifier." };
  try {
    const { supabase } = await requireAdmin();
    const { data: asset, error: assetError } = await supabase.from("portfolio_assets")
      .select("storage_path")
      .eq("id", assetId)
      .eq("site_id", SITE_ID)
      .single();
    if (assetError) return { ok: false, error: assetError.message };

    const { data: draft, error: draftError } = await supabase.from("portfolio_drafts")
      .select("content")
      .eq("site_id", SITE_ID)
      .single();
    if (draftError) return { ok: false, error: draftError.message };
    if (isPortfolioContent(draft.content) && collectAssetIds(draft.content).includes(assetId)) {
      return { ok: false, error: "Remove this image from the draft first, then save the draft before deleting the file." };
    }

    const { count, error: referenceError } = await supabase.from("portfolio_publication_assets")
      .select("asset_id", { count: "exact", head: true })
      .eq("asset_id", assetId);
    if (referenceError) return { ok: false, error: referenceError.message };
    if ((count ?? 0) > 0) return { ok: false, error: "This image belongs to a saved publication and cannot be deleted." };

    const { error: storageError } = await supabase.storage.from("portfolio-drafts").remove([asset.storage_path]);
    if (storageError) return { ok: false, error: `Image file could not be removed: ${storageError.message}` };
    const { error } = await supabase.from("portfolio_assets").delete().eq("id", assetId).eq("site_id", SITE_ID);
    if (error) return { ok: false, error: `Image record could not be removed: ${error.message}` };
    revalidatePath("/admin");
    return { ok: true, message: "Image removed." };
  } catch (error) {
    console.error("Portfolio image removal failed:", error);
    return { ok: false, error: errorMessage(error) };
  }
}

export async function loadDraftAction(): Promise<ActionResult & { content?: PortfolioContent; revision?: number }> {
  try {
    const { supabase } = await requireAdmin();
    const { data, error } = await supabase.from("portfolio_drafts")
      .select("content,revision")
      .eq("site_id", SITE_ID)
      .single();
    if (error) return { ok: false, error: error.message };
    if (!isPortfolioContent(data.content)) return { ok: false, error: "The saved draft has an unsupported content format." };
    return { ok: true, content: data.content, revision: data.revision };
  } catch (error) {
    console.error("Portfolio draft reload failed:", error);
    return { ok: false, error: errorMessage(error) };
  }
}

export async function publicationDiffAction(): Promise<ActionResult & { changes?: string[]; revision?: number }> {
  try {
    const { supabase } = await requireAdmin();
    const [{ data: site, error: siteError }, { data: draft, error: draftError }] = await Promise.all([
      supabase.from("portfolio_sites").select("current_publication_id").eq("id", SITE_ID).single(),
      supabase.from("portfolio_drafts").select("content,revision").eq("site_id", SITE_ID).single(),
    ]);
    if (siteError) return { ok: false, error: siteError.message };
    if (draftError) return { ok: false, error: draftError.message };
    if (!isPortfolioContent(draft.content)) return { ok: false, error: "The saved draft has an unsupported content format." };

    let previous: PortfolioContent | null = null;
    let previousAssets: PortfolioContent["publishedAssets"] = {};
    if (site.current_publication_id) {
      const { data, error } = await supabase.from("portfolio_publications")
        .select("content")
        .eq("id", site.current_publication_id)
        .single();
      if (error) return { ok: false, error: error.message };
      previous = data.content as PortfolioContent;
      previousAssets = previous.publishedAssets ?? {};
    }

    const changes: string[] = [];
    const beforePages = new Map((previous?.chapters ?? []).map((chapter) => [chapter.id, chapter]));
    const afterPages = new Map(draft.content.chapters.map((chapter) => [chapter.id, chapter]));
    for (const [id, chapter] of afterPages) {
      const before = beforePages.get(id);
      if (!before) changes.push(`Added chapter: ${chapter.title}`);
      else if (JSON.stringify(before) !== JSON.stringify(chapter)) changes.push(`Updated chapter: ${chapter.title}`);
    }
    for (const [id, chapter] of beforePages) {
      if (!afterPages.has(id)) changes.push(`Removed chapter: ${chapter.title}`);
    }
    if (!previous || JSON.stringify(previous.profile) !== JSON.stringify(draft.content.profile)) changes.push("Updated cover and portfolio identity.");
    if (!previous || JSON.stringify(previous.contact) !== JSON.stringify(draft.content.contact)) changes.push("Updated contact details.");
    if (previous && JSON.stringify(previous.chapters.map((item) => item.id)) !== JSON.stringify(draft.content.chapters.map((item) => item.id))) {
      changes.push("Changed chapter order.");
    }
    const assetIds = collectAssetIds(draft.content);
    const { data: currentAssets, error: currentAssetsError } = assetIds.length
      ? await supabase.from("portfolio_assets").select("id,alt_text,caption,focus_x,focus_y").in("id", assetIds)
      : { data: [], error: null };
    if (currentAssetsError) return { ok: false, error: currentAssetsError.message };
    for (const asset of currentAssets ?? []) {
      const previousAsset = previousAssets[asset.id];
      if (!previousAsset) changes.push(`Added image: ${asset.alt_text || "image needs alternative text"}`);
      else if (
        previousAsset.altText !== asset.alt_text ||
        previousAsset.caption !== asset.caption ||
        previousAsset.focusX !== Number(asset.focus_x) ||
        previousAsset.focusY !== Number(asset.focus_y)
      ) changes.push(`Updated image details: ${asset.alt_text || "image"}`);
    }
    if (previousAssets) {
      for (const [id, previousAsset] of Object.entries(previousAssets)) {
        if (!assetIds.includes(id)) changes.push(`Removed image: ${previousAsset.altText || "image"}`);
      }
    }
    return { ok: true, changes: changes.length ? changes : ["No content changes since the current publication."], revision: draft.revision };
  } catch (error) {
    console.error("Publication summary failed:", error);
    return { ok: false, error: errorMessage(error) };
  }
}

function validateForPublication(content: PortfolioContent) {
  if (!content.profile.name.trim() || !content.profile.coverTitle.trim() || !content.profile.coverIntro.trim()) {
    return "Add a name, cover title, and introduction before publishing.";
  }
  for (const chapter of content.chapters) {
    if (!chapter.title.trim() || !chapter.eyebrow.trim()) return "Every chapter needs a title and section label.";
    if (chapter.externalUrl && !isAllowedUrl(chapter.externalUrl)) return `Chapter “${chapter.title}” has an invalid link. Use https://, mailto:, or tel:.`;
    if (["full-image", "image-text", "gallery"].includes(chapter.type) && !chapter.assetIds.length) {
      return `Add at least one image to “${chapter.title}” or choose a different page style.`;
    }
    if (chapter.type === "video" && !chapter.externalUrl) return `Add a video link to “${chapter.title}” or choose a different page style.`;
    if (findInvalidRichLink(chapter.body)) return `A rich-text link in “${chapter.title}” is invalid. Use https://, mailto:, or tel:.`;
  }
  if (!content.chapters.some((chapter) => chapter.section === "about")) return "Add an About chapter before publishing.";
  if (content.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content.contact.email)) {
    return "The contact email address is not valid.";
  }
  for (const link of content.contact.links) {
    if (link.url && !isAllowedUrl(link.url)) return `The contact link “${link.label}” must use https://, mailto:, or tel:.`;
  }
  return null;
}

function isAllowedUrl(value: string) {
  return /^(https:\/\/|mailto:|tel:)/i.test(value.trim());
}

function findInvalidRichLink(node: PortfolioContent["chapters"][number]["body"]): boolean {
  if (node.marks?.some((mark) => {
    if (mark.type !== "link") return false;
    const href = mark.attrs?.href;
    return typeof href !== "string" || !isAllowedUrl(href);
  })) return true;
  return (node.content ?? []).some((child) => findInvalidRichLink(child));
}

export async function publishDraftAction(expectedRevision: number): Promise<ActionResult & { publishedAt?: string; version?: number }> {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return { ok: false, error: "Draft revision is invalid. Reload the editor before publishing." };

  const uploadedPublicPaths: string[] = [];
  let supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"] | undefined;
  try {
    const session = await requireAdmin();
    supabase = session.supabase;
    const [{ data: draft, error: draftError }, { data: assetRows, error: assetsError }] = await Promise.all([
      supabase.from("portfolio_drafts").select("content,revision").eq("site_id", SITE_ID).single(),
      supabase.from("portfolio_assets")
        .select("id,storage_path,original_name,alt_text,status")
        .eq("site_id", SITE_ID),
    ]);
    if (draftError) return { ok: false, error: draftError.message };
    if (assetsError) return { ok: false, error: assetsError.message };
    if (draft.revision !== expectedRevision) return { ok: false, error: "Draft changed in another session. Reload before publishing.", conflict: true };
    if (!isPortfolioContent(draft.content)) return { ok: false, error: "The saved draft has an unsupported content format." };

    const validationError = validateForPublication(draft.content);
    if (validationError) return { ok: false, error: validationError };
    const ids = collectAssetIds(draft.content);
    const assets = (assetRows ?? []).filter((asset) => ids.includes(asset.id));
    if (assets.length !== ids.length) return { ok: false, error: "One or more selected images are missing. Remove them from the draft or upload them again." };
    if (assets.some((asset) => asset.status !== "ready")) return { ok: false, error: "Wait for every selected image to finish processing before publishing." };
    if (assets.some((asset) => !asset.alt_text.trim())) return { ok: false, error: "Add alternative text to every selected image before publishing." };

    const publicationId = randomUUID();
    const manifest: Array<{ id: string; path: string }> = [];
    for (const asset of assets) {
      const { data: source, error: downloadError } = await supabase.storage.from("portfolio-drafts").download(asset.storage_path);
      if (downloadError || !source) throw new Error(`Unable to prepare ${asset.original_name}: ${downloadError?.message ?? "image data is missing"}`);
      const sourceBuffer = Buffer.from(await source.arrayBuffer());
      const { data: webp, info } = await sharp(sourceBuffer, { failOn: "error" })
        .rotate()
        .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 84, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      if (!info.width || !info.height || webp.byteLength > 15 * 1024 * 1024) {
        throw new Error(`Image ${asset.original_name} could not be prepared for publication.`);
      }
      const path = `${publicationId}/${asset.id}.webp`;
      const { error: uploadError } = await supabase.storage.from("portfolio-published").upload(path, webp, {
        contentType: "image/webp",
        cacheControl: "31536000",
        upsert: false,
      });
      if (uploadError) throw new Error(`Unable to prepare published image ${asset.original_name}: ${uploadError.message}`);
      uploadedPublicPaths.push(path);
      manifest.push({ id: asset.id, path });
    }

    const { data: result, error } = await supabase.rpc("publish_portfolio_draft", {
      p_publication_id: publicationId,
      p_expected_revision: expectedRevision,
      p_assets: manifest,
    });
    if (error) throw new Error(error.message);
    const publication = result as { version: number; publishedAt: string };
    uploadedPublicPaths.length = 0;
    revalidatePath("/");
    revalidatePath("/admin");
    return { ok: true, version: publication.version, publishedAt: publication.publishedAt };
  } catch (error) {
    console.error("Portfolio publication failed:", error);
    if (supabase && uploadedPublicPaths.length) {
      const { error: cleanupError } = await supabase.storage.from("portfolio-published").remove(uploadedPublicPaths);
      if (cleanupError) console.error("Unable to remove unpublished prepared images:", cleanupError.message);
    }
    return { ok: false, error: errorMessage(error) };
  }
}

export async function rollbackPublicationAction(publicationId: string): Promise<ActionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(publicationId)) return { ok: false, error: "Invalid publication identifier." };
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.rpc("set_portfolio_publication", { p_publication_id: publicationId });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/");
    revalidatePath("/admin");
    return { ok: true, message: "Published version restored. Your draft was not changed." };
  } catch (error) {
    console.error("Portfolio publication restore failed:", error);
    return { ok: false, error: errorMessage(error) };
  }
}
