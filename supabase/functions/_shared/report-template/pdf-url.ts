// Variante convert/url do Gotenberg para o relatório de blocos (spec §9):
// imprime a página /print do Hub esperando o contrato window.__REPORT_READY,
// nunca delay cego. O pdf.ts (convert/html do template A4 legado) fica intocado.
export function buildGotenbergUrlRequest(
  pageUrl: string,
  gotenbergUrl: string,
): { url: string; formData: FormData } {
  const url = `${gotenbergUrl}/forms/chromium/convert/url`;
  const formData = new FormData();
  formData.append("url", pageUrl);
  formData.append("waitForExpression", "window.__REPORT_READY === true");
  formData.append("printBackground", "true");
  // Documento contínuo em A4 com margens: sem o pin de bleed do template
  // legado (ver _shared/report-template/pdf.ts para aquela história).
  formData.append("paperWidth", "8.27");
  formData.append("paperHeight", "11.7");
  formData.append("marginTop", "0.4");
  formData.append("marginBottom", "0.4");
  formData.append("marginLeft", "0.35");
  formData.append("marginRight", "0.35");
  return { url, formData };
}

const GOTENBERG_TIMEOUT_MS = 60_000;

export async function convertUrlToPdf(
  pageUrl: string,
  gotenbergUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const { url, formData } = buildGotenbergUrlRequest(pageUrl, gotenbergUrl);
  const res = await fetchImpl(url, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(GOTENBERG_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "unknown error");
    throw new Error(`Gotenberg URL conversion failed (${res.status}): ${body}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
