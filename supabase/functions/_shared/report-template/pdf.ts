export function buildGotenbergRequest(
  html: string,
  gotenbergUrl: string,
): { url: string; formData: FormData } {
  const url = `${gotenbergUrl}/forms/chromium/convert/html`;
  const formData = new FormData();
  const htmlBlob = new Blob([html], { type: "text/html" });
  formData.append("files", htmlBlob, "index.html");
  // A4 in inches, sized against the template's 210mm x 297mm `.page` box. The
  // rounded 8.27 x 11.69 is 296.926mm tall — SHORTER than the page — which left
  // a 3.5px band of body colour along the bottom of the full-bleed dark cover.
  //
  // paperHeight is honoured almost exactly (asked 841.896pt, got 841.920).
  // paperWidth is NOT: Chromium snaps it, and a real PDF measured 595.920pt
  // (210.2273mm) against the 595.296pt requested here. Retuning this number does
  // not close the resulting right-edge seam — the template's `.cover` widens
  // past the sheet instead. See the bleed note in template-string.ts.
  formData.append("paperWidth", "8.268"); // 210.007mm requested; Chromium emits ~210.23mm
  formData.append("paperHeight", "11.693"); // 297.002mm
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
