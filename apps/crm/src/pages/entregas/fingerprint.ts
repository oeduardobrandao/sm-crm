/**
 * Espelho TS de workflow_fingerprint() / template_fingerprint()
 * (supabase/migrations/20260919000001_post_process_fingerprints.sql, spec §9.4).
 *
 * É uma serialização canônica em TEXTO, sem hash: browser e Postgres têm de
 * produzir byte a byte o mesmo valor, porque a RPC recalcula sob lock e falha
 * com workflow_changed/template_changed quando difere.
 *
 * Regras que NÃO podem mudar sem mudar o SQL junto:
 * - todo campo passa por String(value ?? ''); nulo vira '' (coalesce), e nada é
 *   reparseado com Number()/parseInt() (o SQL serializa o valor cru);
 * - tipo nulo ou vazio vira 'padrao' (coalesce(nullif(tipo,''),'padrao'));
 * - data_limite é 'YYYY-MM-DD' (to_char(date)); iniciado_em é ISO 8601 UTC com
 *   milissegundos (to_char(x at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 * - etapas ordenadas por (ordem, id): workflow_etapas não tem UNIQUE (workflow_id, ordem);
 * - o fluxo tem o cabeçalho 'etapa_atual=<n>' e cada linha vem precedida de '\n'
 *   (string_agg com separador vazio e chr(10) no início de cada linha), logo
 *   zero etapas = só o cabeçalho, sem '\n' final;
 * - o template NÃO tem cabeçalho e junta as linhas com '\n'; a ordem é o índice
 *   base zero do array, não um campo.
 *
 * Limite conhecido: iniciado_em chega do PostgREST com microssegundos; new Date()
 * trunca para ms e to_char(...MS) também emite 3 dígitos. Fixtures da suíte SQL
 * (85.*) usam segundos inteiros. Um template inexistente devolve NULL no SQL;
 * aqui a entrada é a própria linha, então não há análogo.
 */

export interface FingerprintEtapa {
  id?: number | null;
  ordem: number;
  nome?: string | null;
  tipo?: string | null;
  status?: string | null;
  responsavel_id?: number | null;
  prazo_dias?: number | null;
  tipo_prazo?: string | null;
  data_limite?: string | null;
  iniciado_em?: string | null;
}

const s = (v: unknown): string => (v == null ? '' : String(v));

const tipoOrPadrao = (v: unknown): string => {
  const t = s(v);
  return t === '' ? 'padrao' : t;
};

/** 'YYYY-MM-DD' — o PostgREST já devolve `date` nesse formato; o slice só protege
 *  contra um timestamp completo passado por engano. */
const dateOnly = (v: unknown): string => s(v).slice(0, 10);

const isoUtcMs = (v: unknown): string => {
  const str = s(v);
  if (str === '') return '';
  const d = new Date(str);
  return isNaN(d.getTime()) ? '' : d.toISOString();
};

export function buildFingerprint(
  workflow: { etapa_atual: number | null | undefined },
  etapas: readonly FingerprintEtapa[],
): string {
  const sorted = [...etapas].sort((a, b) => a.ordem - b.ordem || (a.id ?? 0) - (b.id ?? 0));
  const lines = sorted
    .map(
      (e) =>
        '\n' +
        [
          s(e.ordem),
          s(e.nome),
          tipoOrPadrao(e.tipo),
          s(e.status),
          s(e.responsavel_id),
          s(e.prazo_dias),
          s(e.tipo_prazo),
          dateOnly(e.data_limite),
          isoUtcMs(e.iniciado_em),
        ].join('|'),
    )
    .join('');
  return `etapa_atual=${s(workflow.etapa_atual)}${lines}`;
}

export function buildTemplateFingerprint(etapas: unknown): string {
  if (!Array.isArray(etapas)) return '';
  return etapas
    .map((raw, i) => {
      const e = (raw ?? {}) as Record<string, unknown>;
      return [s(i), s(e.nome), tipoOrPadrao(e.tipo), s(e.prazo_dias), s(e.tipo_prazo)].join('|');
    })
    .join('\n');
}
