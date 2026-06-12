import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  const url = new URL(req.url);
  const path = url.pathname.replace("/hub-reports", "");
  const token = url.searchParams.get("token");
  if (!token) return json({ error: "token required" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = new Date().toISOString();

  // Verify hub token and enforce feature_hub_portal
  const hubToken = await resolveHubToken(db, token, now);
  if (!hubToken) return json({ error: "Link inválido." }, 404);

  // GET /hub-reports/list — list reports for the client
  if (path === "/list" || path === "/list/") {
    const { data: reports } = await db
      .from("analytics_reports")
      .select("id, report_month, status, generated_at, storage_path, html_storage_path")
      .eq("client_id", hubToken.cliente_id)
      .eq("conta_id", hubToken.conta_id)
      .eq("status", "ready")
      .order("report_month", { ascending: false });

    return json({
      reports: (reports || []).map((r) => ({
        month: r.report_month,
        status: r.status,
        generated_at: r.generated_at,
        has_pdf: !!r.storage_path,
        has_html: !!r.html_storage_path,
      })),
    });
  }

  // GET /hub-reports/html/:month — serve stored HTML for a specific month
  if (path.startsWith("/html/")) {
    const month = path.split("/html/")[1];
    if (!month) return json({ error: "month required" }, 400);

    const { data: report } = await db
      .from("analytics_reports")
      .select("html_storage_path")
      .eq("client_id", hubToken.cliente_id)
      .eq("conta_id", hubToken.conta_id)
      .eq("report_month", month)
      .eq("status", "ready")
      .single();

    if (!report?.html_storage_path) return json({ error: "Report not found" }, 404);

    const { data: htmlData, error: dlError } = await db.storage
      .from("analytics-reports")
      .download(report.html_storage_path);

    if (dlError || !htmlData) return json({ error: "Report not found" }, 404);

    const htmlText = await htmlData.text();

    return new Response(htmlText, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:",
      },
    });
  }

  // GET /hub-reports/pdf-url/:month — return 1-hour signed URL for the PDF
  if (path.startsWith("/pdf-url/")) {
    const month = path.split("/pdf-url/")[1];
    if (!month) return json({ error: "month required" }, 400);

    const { data: report } = await db
      .from("analytics_reports")
      .select("storage_path")
      .eq("client_id", hubToken.cliente_id)
      .eq("conta_id", hubToken.conta_id)
      .eq("report_month", month)
      .eq("status", "ready")
      .single();

    if (!report?.storage_path) return json({ error: "Report not found" }, 404);

    const { data: signedUrl, error: signError } = await db.storage
      .from("analytics-reports")
      .createSignedUrl(report.storage_path, 3600); // 1 hour

    if (signError || !signedUrl?.signedUrl) return json({ error: "Failed to generate URL" }, 500);

    return json({ url: signedUrl.signedUrl });
  }

  return json({ error: "Not found" }, 404);
});
