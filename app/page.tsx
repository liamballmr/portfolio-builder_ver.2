import { unstable_noStore as noStore } from "next/cache";
import { DEFAULT_CONTENT, isPortfolioContent } from "@/lib/portfolio";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import PortfolioReader from "./reader";

export const dynamic = "force-dynamic";

function PortfolioUnavailable({ message }: { message: string }) {
  return (
    <main className="portfolio-unavailable">
      <span className="page-eyebrow">PORTFOLIO UNAVAILABLE</span>
      <h1>We can’t open the book right now.</h1>
      <p>{message}</p>
      <a href="/">TRY AGAIN</a>
    </main>
  );
}

export default async function HomePage() {
  noStore();
  if (!isSupabaseConfigured()) {
    return <PortfolioReader content={DEFAULT_CONTENT} demo />;
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    console.error("Public portfolio Supabase initialization failed:", error);
    return <PortfolioUnavailable message="The published portfolio could not be loaded. Please try again later." />;
  }

  const { data, error } = await supabase.rpc("get_portfolio_publication");
  if (error) {
    console.error("Public portfolio lookup failed:", error.message);
    return <PortfolioUnavailable message="The published portfolio could not be loaded. Please try again later." />;
  }
  if (!data || typeof data !== "object" || !("content" in data) || !isPortfolioContent(data.content)) {
    return (
      <main className="portfolio-unavailable">
        <span className="page-eyebrow">COMING SOON</span>
        <h1>This portfolio is being prepared.</h1>
        <p>There isn’t a published version yet. Please check back soon.</p>
      </main>
    );
  }

  return <PortfolioReader content={data.content} />;
}
