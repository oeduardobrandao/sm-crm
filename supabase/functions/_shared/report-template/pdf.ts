export function buildGotenbergRequest(
  html: string,
  gotenbergUrl: string,
): { url: string; formData: FormData } {
  const url = `${gotenbergUrl}/forms/chromium/convert/html`;
  const formData = new FormData();
  const htmlBlob = new Blob([html], { type: "text/html" });
  formData.append("files", htmlBlob, "index.html");
  // A4 in inches, to enough precision to match the template's 210mm x 297mm
  // `.page` box. The rounded 8.27 x 11.69 is 210.058 x 296.926mm — a sheet
  // WIDER and SHORTER than the page, so the body colour showed as a seam down
  // the side and a 3.5px band along the bottom of the full-bleed dark cover.
  // These values are a hair larger than the page box in both axes, so the page
  // never overflows onto a blank sheet either.
  formData.append("paperWidth", "8.268"); // 210.007mm
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
