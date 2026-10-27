import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { submitLinhaAcao } from '../../api';
import { StatusPill } from '../../components/StatusPill';
import { useHubLook } from '../../hooks/useHubLook';
import { sanitizeExternalUrl } from '../../lib/security';
import { HUB_LINHAS_KEY } from '../../queries';
import type {
  HubLinha,
  HubLinhaAcaoBody,
  HubLinhaColuna,
  HubLinhaFormato,
  HubLinhaItem,
  HubLinhaResposta,
} from '../../types';
import { dayParts, formatColumnValue, instantLabel, monthName } from './linhaFormat';
import { groupByWeek, type LinhaWeek } from './linhaWeeks';

const FORMATOS: HubLinhaFormato[] = ['feed', 'carrossel', 'reels', 'stories'];

/** The client's own comments on the plan: what the sticky bar counts. */
function isClientComment(r: HubLinhaResposta): boolean {
  return r.acao === 'comentario' && !r.is_workspace_user && !!r.comentario?.trim();
}

function Thread({ respostas }: { respostas: HubLinhaResposta[] }) {
  const { t } = useTranslation('hubLinha');
  if (respostas.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {respostas.map((r) => (
        <li key={r.id} className="hub-bg-soft rounded-lg px-3 py-2 text-[13px]">
          <span className="font-semibold hub-txt">
            {r.is_workspace_user ? t('equipe') : t('voce')}
          </span>
          <span className="hub-tx3">{' · '}</span>
          <span className="hub-tx2 whitespace-pre-line">{r.comentario}</span>
        </li>
      ))}
    </ul>
  );
}

function ExtraValue({ coluna, text }: { coluna: HubLinhaColuna; text: string }) {
  const href = coluna.tipo === 'url' ? sanitizeExternalUrl(text) : '#';
  return (
    <span className="text-[12px]">
      <span className="hub-tx3">{coluna.nome} </span>
      {href !== '#' ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="hub-tx2 underline underline-offset-2 break-all"
        >
          {text}
        </a>
      ) : (
        <span className="hub-tx2">{text}</span>
      )}
    </span>
  );
}

interface RowProps {
  item: HubLinhaItem;
  colunas: HubLinhaColuna[];
  respostas: HubLinhaResposta[];
  editable: boolean;
  busy: boolean;
  composing: boolean;
  error: string | null;
  onOpen: () => void;
  onCancel: () => void;
  /** Resolves true when the comment was saved; false keeps the draft for another try. */
  onSave: (text: string) => Promise<boolean>;
}

function Row({
  item,
  colunas,
  respostas,
  editable,
  busy,
  composing,
  error,
  onOpen,
  onCancel,
  onSave,
}: RowProps) {
  const { t, i18n } = useTranslation('hubLinha');
  const [draft, setDraft] = useState('');
  useUnsavedWork(composing && draft.trim() !== '');
  const date = item.data ? dayParts(item.data, i18n.language) : null;
  const extras = colunas
    .map((c) => ({ c, text: formatColumnValue(c, item.valores[c.id], i18n.language, t('sim')) }))
    .filter((e) => e.text !== '');

  return (
    <li data-linha-item className="flex gap-3.5 py-3.5 border-t hub-border first:border-t-0">
      <div className="w-11 shrink-0 text-center" aria-hidden={date ? undefined : true}>
        {date ? (
          <>
            <div className="text-[11px] uppercase tracking-wide hub-tx3">{date.weekday}</div>
            <div className="font-display text-[22px] leading-tight hub-txt">{date.day}</div>
          </>
        ) : (
          <div className="text-[18px] hub-tx3">-</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusPill tone="neutral" semantic="neutral">
            {t(`formato.${item.tipo}`)}
          </StatusPill>
          {extras.map((e) => (
            <ExtraValue key={e.c.id} coluna={e.c} text={e.text} />
          ))}
        </div>
        <p className="mt-1.5 text-[15px] font-semibold hub-txt">
          {item.titulo.trim() || t('semTitulo')}
        </p>
        {item.direcao.trim() && (
          <p className="mt-0.5 text-[13.5px] hub-tx2 whitespace-pre-line">{item.direcao}</p>
        )}
        <Thread respostas={respostas} />
        {editable && !composing && (
          <button
            type="button"
            onClick={onOpen}
            disabled={busy}
            className="mt-2 text-[13px] font-semibold hub-tx2 underline underline-offset-2"
          >
            {t('comentar')}
          </button>
        )}
        {editable && composing && (
          <form
            className="mt-2 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim();
              if (!text) return;
              void onSave(text).then((saved) => {
                if (saved) setDraft('');
              });
            }}
          >
            <textarea
              aria-label={t('seuComentario')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              maxLength={2000}
              className="w-full rounded-lg border hub-border hub-bg-card px-3 py-2 text-[14px] hub-txt hub-focus-accent focus:outline-none"
            />
            {error && (
              <p role="alert" className="text-[13px]" style={{ color: '#b0472e' }}>
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || draft.trim() === ''}
                className="hub-btn-primary px-3.5 py-2 min-h-[40px] rounded-[4px] text-[13px] font-semibold disabled:opacity-50"
              >
                {busy ? t('salvando') : t('salvarComentario')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft('');
                  onCancel();
                }}
                disabled={busy}
                className="hub-btn-secondary px-3.5 py-2 min-h-[40px] rounded-[4px] text-[13px] font-semibold"
              >
                {t('cancelar')}
              </button>
            </div>
          </form>
        )}
      </div>
    </li>
  );
}

export interface LinhaCardProps {
  linha: HubLinha;
  token: string;
  agencia: string;
  /** Pin the decision bar to the viewport bottom. Only one card may do it at a time. */
  floatingBar: boolean;
}

export function LinhaCard({ linha, token, agencia, floatingBar }: LinhaCardProps) {
  const { t, i18n } = useTranslation('hubLinha');
  const pauta = useHubLook() === 'pauta';
  const qc = useQueryClient();
  const editable = linha.status === 'enviada';
  const lang = i18n.language;

  const [composingId, setComposingId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [ajustesText, setAjustesText] = useState('');
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);

  const mutation = useMutation({
    mutationFn: (body: HubLinhaAcaoBody) => submitLinhaAcao(token, body),
    // Success or not, resync: a 409 means the agency changed the linha under the client.
    onSettled: () => qc.invalidateQueries({ queryKey: [HUB_LINHAS_KEY, token] }),
  });
  const busy = mutation.isPending;
  useUnsavedWork(busy || (asking && ajustesText.trim() !== ''));

  async function send(scope: string, body: Omit<HubLinhaAcaoBody, 'linha_id'>): Promise<boolean> {
    setError(null);
    try {
      await mutation.mutateAsync({ linha_id: linha.id, ...body });
      return true;
    } catch {
      setError({ scope, message: t('erroAcao') });
      return false;
    }
  }

  const respostas = linha.respostas;
  const clientComments = respostas.filter(isClientComment).length;
  const generalNotes = respostas.filter((r) => r.item_id === null && !!r.comentario?.trim());
  const itemNotes = (id: string) =>
    respostas.filter((r) => r.item_id === id && !!r.comentario?.trim());

  const formatWeek = (w: LinhaWeek) =>
    w.semData
      ? t('semData')
      : t('semana', { inicio: w.inicio, fim: w.fim, mes: monthName(w.mes, lang) });
  const weeks = groupByWeek(linha.itens, linha.periodo, formatWeek);

  const total = linha.itens.length;
  const sentOn = instantLabel(linha.enviada_at, lang);
  const summaryKey = `resumo.${sentOn ? '' : 'semEnvio.'}${total === 1 ? 'um' : 'varios'}`;
  const counts = FORMATOS.map((f) => ({
    f,
    n: linha.itens.filter((i) => i.tipo === f).length,
  })).filter((c) => c.n > 0);

  const decidedOn = instantLabel(linha.decidida_at, lang);

  async function askAdjustments() {
    if (clientComments > 0) {
      await send('linha', { acao: 'ajustes' });
      return;
    }
    setError(null);
    setAsking(true);
  }

  async function submitAdjustments() {
    const text = ajustesText.trim();
    if (!text) {
      setError({ scope: 'linha', message: t('ajustesObrigatorio') });
      return;
    }
    if (await send('linha', { acao: 'ajustes', comentario: text })) {
      setAsking(false);
      setAjustesText('');
    }
  }

  const barError = error?.scope === 'linha' ? error.message : null;
  const barClass = floatingBar
    ? 'fixed bottom-0 inset-x-0 md:left-[240px] z-20 hub-bg-card border-t hub-border'
    : 'mt-4 border-t hub-border';

  return (
    <section className="hub-card rounded-xl border hub-border p-5 sm:p-6">
      <header>
        <div className={pauta ? 'hub-eyebrow mb-2' : 'hub-eyebrow-plain mb-1.5'}>
          {monthName(linha.periodo, lang)}
        </div>
        <h3 className="font-display text-[22px] leading-tight font-medium hub-txt">
          {t('titulo', { mes: monthName(linha.periodo, lang) })}
        </h3>
        <p className="mt-1 text-[13.5px] hub-tx2">
          {t(summaryKey, { n: total, agencia, data: sentOn })}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {counts.map((c) => (
            <StatusPill key={c.f} tone="neutral" semantic="neutral">
              {c.n} {t(`formato.${c.f}`)}
            </StatusPill>
          ))}
          {linha.status === 'aprovada' && (
            <StatusPill tone="accent" semantic="ok">
              {t('aprovadaEm', { data: decidedOn })}
            </StatusPill>
          )}
          {linha.status === 'ajustes' && (
            <StatusPill tone="danger" semantic="fix">
              {t('ajustesEm', { data: decidedOn })}
            </StatusPill>
          )}
        </div>
        {editable && <p className="mt-3 text-[13.5px] hub-tx2">{t('intro')}</p>}
      </header>

      {generalNotes.length > 0 && <Thread respostas={generalNotes} />}

      <div className="mt-5 space-y-5">
        {weeks.map((week) => (
          <div key={week.label}>
            <h4 className={pauta ? 'hub-eyebrow mb-1' : 'hub-eyebrow-plain mb-1'}>{week.label}</h4>
            <ul>
              {week.itens.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  colunas={linha.colunas}
                  respostas={itemNotes(item.id)}
                  editable={editable}
                  busy={busy}
                  composing={composingId === item.id}
                  error={error?.scope === item.id ? error.message : null}
                  onOpen={() => {
                    setError(null);
                    setComposingId(item.id);
                  }}
                  onCancel={() => {
                    setError(null);
                    setComposingId(null);
                  }}
                  onSave={async (text) => {
                    const saved = await send(item.id, {
                      acao: 'comentario',
                      item_id: item.id,
                      comentario: text,
                    });
                    if (saved) setComposingId(null);
                    return saved;
                  }}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {editable && (
        <>
          {floatingBar && <div aria-hidden className="h-40" />}
          <div className={barClass}>
            <div className="max-w-5xl mx-auto px-5 py-3 space-y-3">
              {asking && (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitAdjustments();
                  }}
                >
                  <textarea
                    aria-label={t('ajustesRotulo')}
                    placeholder={t('ajustesObrigatorio')}
                    value={ajustesText}
                    onChange={(e) => setAjustesText(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    className="w-full rounded-lg border hub-border hub-bg-card px-3 py-2 text-[14px] hub-txt hub-focus-accent focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busy}
                      className="hub-btn-primary px-3.5 py-2 min-h-[40px] rounded-[4px] text-[13px] font-semibold disabled:opacity-50"
                    >
                      {t('enviarAjustes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAsking(false);
                        setError(null);
                      }}
                      disabled={busy}
                      className="hub-btn-secondary px-3.5 py-2 min-h-[40px] rounded-[4px] text-[13px] font-semibold"
                    >
                      {t('cancelar')}
                    </button>
                  </div>
                </form>
              )}
              {barError && (
                <p role="alert" className="text-[13px]" style={{ color: '#b0472e' }}>
                  {barError}
                </p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[13px] hub-tx2">
                  {t(clientComments === 1 ? 'comentariosNaLinha.um' : 'comentariosNaLinha.varios', {
                    n: clientComments,
                  })}
                </span>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void askAdjustments()}
                    disabled={busy}
                    className="hub-btn-secondary px-4 py-2.5 min-h-[44px] rounded-[4px] text-[13px] font-semibold disabled:opacity-50"
                  >
                    {t('pedirAjustes')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void send('linha', { acao: 'aprovado' })}
                    disabled={busy}
                    className="hub-btn-primary px-4 py-2.5 min-h-[44px] rounded-[4px] text-[13px] font-semibold disabled:opacity-50"
                  >
                    {t('aprovar')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
