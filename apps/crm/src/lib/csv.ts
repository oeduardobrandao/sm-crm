// =============================================
// Helper para Processamento de CSV
// =============================================

/**
 * Converte um arquivo CSV em um array de objetos.
 * Espera que a primeira linha contenha os cabeçalhos.
 */
export function parseCSV(csvText: string): Record<string, string>[] {
  const lines = csvText.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const data: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Regex para lidar com vírgulas dentro de aspas duplas, ex: "Valor,10", outro_campo
    const values = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      let val = values[index] ? values[index].trim() : '';
      // Remove aspas nas extremidades se houver
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1);
      }
      row[header] = val;
    });

    data.push(row);
  }

  return data;
}

/**
 * Aciona o seletor de arquivo nativo para arquivos CSV e retorna as linhas lidas.
 */
export function openCSVSelector(onUpload: (data: Record<string, string>[]) => void, onError: (err: Error) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv';
  input.style.display = 'none';

  input.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

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
