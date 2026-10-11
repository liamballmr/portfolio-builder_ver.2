import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase environment variables are not configured.");

  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(values) {
        try {
          for (const { name, value, options } of values) {
            cookieStore.set(name, value, options);
          }
        } catch (error) {
          if (error instanceof Error && /Cookies can only be modified/i.test(error.message)) return;
          throw error;
        }
      },
    },
  });
}

export function configuredAdminEmail(): string {
  const email = process.env.PORTFOLIO_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("PORTFOLIO_ADMIN_EMAIL is not configured.");
  return email;
}

export function getPublicAssetUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error("Supabase public URL is not configured.");
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/portfolio-published/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(`Unable to verify your session: ${error.message}`);
  if (!data.user?.email || data.user.email.toLowerCase() !== configuredAdminEmail()) {
    throw new Error("You are not authorized to manage this portfolio.");
  }
  return { supabase, user: data.user };
}
