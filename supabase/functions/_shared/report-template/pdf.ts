export function buildGotenbergRequest(
  html: string,
  gotenbergUrl: string,
): { url: string; formData: FormData } {
  const url = `${gotenbergUrl}/forms/chromium/convert/html`;
  const formData = new FormData();
  const htmlBlob = new Blob([html], { type: "text/html" });
  formData.append("files", htmlBlob, "index.html");
  // Measured across three real PDFs: this Gotenberg's Chromium emits a
  // 595.92x841.92pt sheet NO MATTER what paper size is requested (via these
  // inch fields or via CSS). What preferCssPageSize does control is the
  // LAYOUT viewport: it becomes the template's @page size. The template
  // exploits that by declaring 795x1123px — just past the pinned
  // 794.56x1122.56px sheet — so every page paints edge to edge and the sheet
  // clips the 0.44px overhang. Full story in the bleed note in
  // template-string.ts; change the @page size there, not the numbers here.
  formData.append("preferCssPageSize", "true");
  // Fallback only, in case preferCssPageSize is ever dropped: at least the
  // 795x1123px page box, so the sheet is never smaller than the page (a
  // shorter sheet left a band of body colour along the cover's bottom edge).
  formData.append("paperWidth", "8.2813"); // 210.35mm vs the 210.34mm page box
  formData.append("paperHeight", "11.698"); // 297.13mm vs the 297.13mm page box
  formData.append("marginTop", "0");
  formData.append("marginBottom", "0");
  formData.append("marginLeft", "0");
  formData.append("marginRight", "0");
  formData.append("printBackground", "true");
  return { url, formData };
}

export async function convertHtmlToPdf(
  html: string,
  gotenbergUrl: string,
): Promise<Uint8Array> {
  const { url, formData } = buildGotenbergRequest(html, gotenbergUrl);
  const res = await fetch(url, { method: "POST", body: formData });
  if (!res.ok) {
    const body = await res.text().catch(() => "unknown error");
    throw new Error(`Gotenberg PDF conversion failed (${res.status}): ${body}`);
  }
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}
