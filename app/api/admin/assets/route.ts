import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const SITE_ID = "00000000-0000-4000-8000-000000000001";
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MIME_TO_EXT = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export async function POST(request: Request) {
  let supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"] | undefined;
  let uploadedPath: string | undefined;
  try {
    const origin = request.headers.get("origin");
    const requestHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (!origin || !requestHost || new URL(origin).host !== requestHost) {
      return NextResponse.json({ error: "Cross-origin upload requests are not allowed." }, { status: 403 });
    }
    const requestSize = Number(request.headers.get("content-length") ?? 0);
    if (requestSize > MAX_FILE_SIZE + 64 * 1024) {
      return NextResponse.json({ error: "Image files must be under 15 MB." }, { status: 413 });
    }
    const session = await requireAdmin();
    supabase = session.supabase;
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose an image file to upload." }, { status: 400 });
    if (!MIME_TO_EXT.has(file.type)) return NextResponse.json({ error: "Upload a JPEG, PNG, or WebP image." }, { status: 415 });
    if (file.size < 1 || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Image files must be under 15 MB." }, { status: 413 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(buffer, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height || !metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
      return NextResponse.json({ error: "The uploaded file is not a supported image." }, { status: 415 });
    }
    const expectedFormat = file.type === "image/jpeg" ? "jpeg" : file.type === "image/png" ? "png" : "webp";
    if (metadata.format !== expectedFormat) {
      return NextResponse.json({ error: "The image content does not match its declared file type." }, { status: 415 });
    }
    if (metadata.width * metadata.height > 80_000_000) {
      return NextResponse.json({ error: "This image is too large to process safely." }, { status: 413 });
    }

    const id = randomUUID();
    const path = `${session.user.id}/${id}/original.${MIME_TO_EXT.get(file.type)}`;
    const { error: uploadError } = await supabase.storage.from("portfolio-drafts").upload(path, buffer, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);
    uploadedPath = path;
    const { data: signed, error: signedError } = await supabase.storage.from("portfolio-drafts").createSignedUrl(path, 3600);
    if (signedError || !signed?.signedUrl) throw new Error(`Private image preview could not be created: ${signedError?.message ?? "no preview URL returned"}`);

    const { data: asset, error: insertError } = await supabase.from("portfolio_assets").insert({
      id,
      site_id: SITE_ID,
      storage_path: path,
      original_name: file.name.slice(0, 255),
      mime_type: file.type,
      byte_size: file.size,
      width: metadata.width,
      height: metadata.height,
      created_by: session.user.id,
    }).select("id,original_name,mime_type,byte_size,width,height,alt_text,caption,focus_x,focus_y,status,created_at").single();
    if (insertError) throw new Error(`Image metadata could not be saved: ${insertError.message}`);
    uploadedPath = undefined;

    return NextResponse.json({
      asset: {
        id: asset.id,
        originalName: asset.original_name,
        mimeType: asset.mime_type,
        byteSize: asset.byte_size,
        width: asset.width,
        height: asset.height,
        altText: asset.alt_text,
        caption: asset.caption,
        focusX: asset.focus_x,
        focusY: asset.focus_y,
        status: asset.status,
        createdAt: asset.created_at,
        signedUrl: signed.signedUrl,
      },
    }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Portfolio image upload failed:", error);
    if (supabase && uploadedPath) {
      const { error: cleanupError } = await supabase.storage.from("portfolio-drafts").remove([uploadedPath]);
      if (cleanupError) console.error("Unable to remove failed image upload:", cleanupError.message);
    }
    const message = error instanceof Error ? error.message : "Image upload failed.";
    const status = message.includes("not authorized") ? 403 : message.includes("session") ? 401 : 500;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
