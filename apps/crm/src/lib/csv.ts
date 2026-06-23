// =============================================
// Helper para Processamento de CSV
// =============================================

/**
 * Faz o parse de um texto CSV em registros (linhas de campos), seguindo o
 * RFC 4180: campos entre aspas podem conter vírgulas, quebras de linha e
 * aspas escapadas (`""`). Lida com terminações de linha `\n` e `\r\n`.
 */
function parseCSVRecords(csvText: string): string[][] {
  // Remove BOM UTF-8 que Excel/Sheets costumam adicionar no início do arquivo.
  const text = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;

  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let started = false; // há conteúdo pendente (campo ou linha) a ser emitido?

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    records.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // aspas escapadas
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      started = true;
    } else if (ch === ',') {
      endField();
      started = true;
    } else if (ch === '\n') {
      endRow();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
      started = true;
    }
  }

  // Emite o último registro se houver conteúdo pendente (sem newline final).
  if (started || field !== '' || row.length > 0) endRow();

  return records;
}

/**
 * Converte um arquivo CSV em um array de objetos.
 * Espera que a primeira linha contenha os cabeçalhos.
 */
export function parseCSV(csvText: string): Record<string, string>[] {
  // Ignora registros totalmente vazios (linhas em branco entre os dados).
  const records = parseCSVRecords(csvText).filter((cells) =>
    cells.some((cell) => cell.trim() !== ''),
  );
  if (records.length < 2) return [];

  const headers = records[0].map((h) => h.trim().toLowerCase());
  const data: Record<string, string>[] = [];

  for (let i = 1; i < records.length; i++) {
    const values = records[i];
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] != null ? values[index].trim() : '';
    });

    data.push(row);
  }

  return data;
}

/**
 * Aciona o seletor de arquivo nativo para arquivos CSV e retorna as linhas lidas.
 */
export function openCSVSelector(
  onUpload: (data: Record<string, string>[]) => void,
  onError: (err: Error) => void,
  onStart?: () => void,
) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv';
  input.style.display = 'none';

  input.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    // Signal that a file was actually chosen and read/parse is starting.
    onStart?.();

    try {
      const text = await file.text();
      const data = parseCSV(text);
      if (data.length === 0) throw new Error('Arquivo vazio ou inválido.');
      onUpload(data);
    } catch (error) {
      onError(error instanceof Error ? error : new Error('Falha ao processar o arquivo CSV.'));
    }

    // Cleanup
    document.body.removeChild(input);
  });

  document.body.appendChild(input);
  input.click();
}
