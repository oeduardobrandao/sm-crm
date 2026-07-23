export function buildGotenbergRequest(
  html: string,
  gotenbergUrl: string,
): { url: string; formData: FormData } {
  const url = `${gotenbergUrl}/forms/chromium/convert/html`;
  const formData = new FormData();
  const htmlBlob = new Blob([html], { type: "text/html" });
  formData.append("files", htmlBlob, "index.html");
  // The template's @page declares 794x1123 CSS px (210.06x297.13mm) — sized on
  // Chromium's integer-pixel layout grid on purpose. preferCssPageSize makes
  // Chromium use that CSS size, so the sheet and the layout viewport are the
  // SAME width and the full-bleed cover paints to the very edge. With the
  // inch-based paper size alone the sheet came out 794.56px (measured
  // 595.920pt against 595.296pt requested) and the floored-out 0.56px showed
  // as a body-colour seam down the cover's right edge. Full story in the bleed
  // note in template-string.ts.
  formData.append("preferCssPageSize", "true");
  // Fallback only, in case preferCssPageSize is ever dropped: just OVER the
  // 794x1123px page box, so the sheet is never smaller than the page (a
  // shorter sheet left a band of body colour along the cover's bottom edge).
  formData.append("paperWidth", "8.2709"); // 210.08mm vs the 210.06mm page box
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
