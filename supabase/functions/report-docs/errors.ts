// Erros tipados das rotas. Separados de generate.ts para evitar import
// circular quando snapshot-source.ts (Task 4) também precisar deles.
export class GenerateError extends Error {
  constructor(
    public code: "not_found" | "bad_month" | "feature_disabled" | "invalid_template",
    msg?: string,
  ) {
    super(msg ?? code);
  }
}

export class DocActionError extends Error {
  constructor(
    public code: "not_found" | "pdf_not_configured" | "pdf_failed",
    msg?: string,
  ) {
    super(msg ?? code);
  }
}

// Bucket dos PDFs exportados (reuso do bucket privado do pipeline legado, com
// prefixo docs/ separando). Mora aqui por ser consumido por pdf.ts E
// delete-doc.ts sem criar dependência entre eles.
export const PDF_BUCKET = "analytics-reports";
