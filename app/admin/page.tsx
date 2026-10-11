import Link from "next/link";
import type { ReactNode } from "react";
import { AdminEditor, type PublicationRecord } from "./editor";
import { LoginForm } from "./login-form";
import { isSupabaseConfigured, configuredAdminEmail, createSupabaseServerClient } from "@/lib/supabase/server";
import { signOutAction } from "./actions";
import type { PortfolioAsset, PortfolioContent } from "@/lib/portfolio";

const SITE_ID = "00000000-0000-4000-8000-000000000001";

export const dynamic = "force-dynamic";

function SetupMessage({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <main className="admin-setup">
      <Link className="admin-setup__back" href="/">← BACK TO THE BOOK</Link>
      <section className="admin-setup__card">
        <span className="page-eyebrow">PRIVATE EDITOR SETUP</span>
        <div className="admin-setup__mark">L<span>—</span>P</div>
        <h1>One-time setup<br />is required.</h1>
        <p>{message}</p>
        <div className="admin-setup__status"><span className="status-dot" />PRIVATE ACCESS IS NOT AVAILABLE YET</div>
        {children}
        <Link href="/" className="admin-setup__button">RETURN TO PORTFOLIO <span>↗</span></Link>
        <p className="admin-setup__fineprint">No draft content is shown until your Supabase account and permissions are verified.</p>
      </section>
      <footer>LIAM · PORTFOLIO BOOK</footer>
    </main>
  );
}

export default async function AdminPage() {
  if (!isSupabaseConfigured() || !process.env.PORTFOLIO_ADMIN_EMAIL) {
    return <SetupMessage message="Add the Supabase URL, publishable key, and Liam’s exact account email to .env.local, then run the SQL migration listed in the project README." />;
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to initialize Supabase.";
    console.error("Admin Supabase initialization failed:", error);
    return <SetupMessage message={message} />;
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError && authError.name !== "AuthSessionMissingError") {
    console.error("Admin session verification failed:", authError.message);
    return <SetupMessage message="The secure session could not be verified. Refresh the page, and check the Supabase configuration if the problem continues." />;
  }
  if (!authData.user) {
    return (
      <main className="admin-setup">
        <Link className="admin-setup__back" href="/">← BACK TO THE BOOK</Link>
        <section className="admin-setup__card admin-login">
          <span className="page-eyebrow">PRIVATE EDITOR</span>
          <div className="admin-setup__mark">L<span>—</span>P</div>
          <h1>Welcome<br />back, Liam.</h1>
          <p>Sign in to edit your private draft. Publishing changes the public portfolio only after you review and confirm them.</p>
          <LoginForm />
        </section>
        <footer>LIAM · PORTFOLIO BOOK</footer>
      </main>
    );
  }

  let allowedEmail: string;
  try {
    allowedEmail = configuredAdminEmail();
  } catch {
    return <SetupMessage message="PORTFOLIO_ADMIN_EMAIL is missing. Set it to the email address of Liam’s pre-created Supabase account." />;
  }
  if (authData.user.email?.toLowerCase() !== allowedEmail) {
    return (
      <SetupMessage message="This signed-in account is not allowed to edit the portfolio. Sign out and use Liam’s pre-created account.">
        <form action={signOutAction}><button className="admin-primary-button" type="submit">SIGN OUT</button></form>
      </SetupMessage>
    );
  }

  const [{ data: site, error: siteError }, { data: draft, error: draftError }, { data: rows, error: assetsError }, { data: publications, error: publicationsError }] = await Promise.all([
    supabase.from("portfolio_sites").select("current_publication_id").eq("id", SITE_ID).single(),
    supabase.from("portfolio_drafts").select("content,revision,updated_at").eq("site_id", SITE_ID).single(),
    supabase.from("portfolio_assets").select("id,original_name,mime_type,byte_size,width,height,alt_text,caption,focus_x,focus_y,status,created_at,storage_path").eq("site_id", SITE_ID).order("created_at", { ascending: false }),
    supabase.from("portfolio_publications").select("id,version,content,created_at").eq("site_id", SITE_ID).order("version", { ascending: false }).limit(30),
  ]);
  const dataError = siteError ?? draftError ?? assetsError ?? publicationsError;
  if (dataError) {
    console.error("Admin data load failed:", dataError.message);
    return <SetupMessage message={`The editor could not load portfolio data: ${dataError.message}. Confirm that the migration was applied and Liam’s user ID is assigned as portfolio owner.`} />;
  }
  if (!draft || !site || !Array.isArray(rows) || !Array.isArray(publications)) {
    return <SetupMessage message="Portfolio setup is incomplete. Apply the database migration and assign Liam’s account to the portfolio site." />;
  }

  const assets: PortfolioAsset[] = await Promise.all(rows.map(async (row) => {
    const { data: signed, error } = await supabase.storage.from("portfolio-drafts").createSignedUrl(row.storage_path, 3600);
    if (error) console.error(`Private preview URL failed for ${row.original_name}:`, error.message);
    return {
      id: row.id,
      originalName: row.original_name,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      width: row.width,
      height: row.height,
      altText: row.alt_text,
      caption: row.caption,
      focusX: Number(row.focus_x),
      focusY: Number(row.focus_y),
      status: row.status,
      createdAt: row.created_at,
      signedUrl: signed?.signedUrl,
      previewError: error?.message,
    };
  }));

  const versions: PublicationRecord[] = publications.map((publication) => ({
    id: publication.id,
    version: publication.version,
    content: publication.content as PortfolioContent,
    createdAt: publication.created_at,
    current: publication.id === site.current_publication_id,
  }));

  return (
    <AdminEditor
      initialContent={draft.content as PortfolioContent}
      initialRevision={draft.revision}
      initialUpdatedAt={draft.updated_at}
      initialAssets={assets}
      publications={versions}
    />
  );
}
