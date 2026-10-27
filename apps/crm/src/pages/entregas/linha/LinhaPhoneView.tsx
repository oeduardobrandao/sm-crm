import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
import { ChevronLeft, ChevronRight, Loader2, MessageSquare, Send } from 'lucide-react';
import { ClienteFoto } from '@/components/ClienteFoto';
import { QueryErrorCard } from '@/components/QueryErrorCard';
import type { Cliente } from '@/store';
import type { LinhaEditorial, LinhaItem, LinhaResposta } from '@/store/linhaEditorial';
import { FormatoPill } from './FormatoPill';
import { LinhaAprovacaoChip } from './LinhaAprovacaoChip';
import { LinhaStatusBadge } from './LinhaStatusBadge';
import { contagemLinha } from './linhaLogic';
import { mesTitulo, shiftMes } from './mesNav';

interface LinhaPhoneViewProps {
  clientes: Cliente[];
  /** Month's linhas, one per client at most. */
  linhas: LinhaEditorial[];
  /** `YYYY-MM`. */
  mes: string;
  selectedId: number | null;
  fotosDe: (c: Cliente) => string[];
  linhasLoading: boolean;
  linhasError: boolean;
  /** Rows, comments and loading state of the selected client's linha. */
  itens: LinhaItem[];
  itensLoading: boolean;
  itensError: boolean;
  respostas: LinhaResposta[];
  enviando: boolean;
  onSelect: (clienteId: number) => void;
  onMesChange: (mes: string) => void;
  /** The view's own "send" mutation. */
  onEnviar: () => void;
  onRetry: () => void;
}

/**
 * Phone layout of the linha editorial (spec §6.6): the client list, then a read-only list of
 * item cards for the selected client, its status and "Enviar ao cliente". Editing and
 * conversion stay on the computer.
 */
export function LinhaPhoneView({
  clientes,
  linhas,
  mes,
  selectedId,
  fotosDe,
  linhasLoading,
  linhasError,
  itens,
  itensLoading,
  itensError,
  respostas,
  enviando,
  onSelect,
  onMesChange,
  onEnviar,
  onRetry,
}: LinhaPhoneViewProps) {
  const { t } = useTranslation('linha');
  const dateLocale = useDateFnsLocale();
  const linhaPorCliente = useMemo(() => new Map(linhas.map((l) => [l.cliente_id, l])), [linhas]);
  // Clients with a linha first, then alphabetical inside each group (same order as the rail).
  const ordenados = useMemo(
    () =>
      clientes
        .filter((c) => c.id != null)
        .sort((a, b) => {
          const ha = linhaPorCliente.has(a.id!) ? 0 : 1;
          const hb = linhaPorCliente.has(b.id!) ? 0 : 1;
          return ha - hb || a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
        }),
    [clientes, linhaPorCliente],
  );
  const cliente = clientes.find((c) => c.id === selectedId) ?? null;
  const linha = selectedId != null ? (linhaPorCliente.get(selectedId) ?? null) : null;

  const comentariosPorItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of respostas) {
      if (r.item_id && r.comentario?.trim()) map.set(r.item_id, (map.get(r.item_id) ?? 0) + 1);
    }
    return map;
  }, [respostas]);

  const podeEnviar = !!linha && itens.length > 0 && !enviando;
  const mostraEnviar = linha?.status === 'rascunho' || linha?.status === 'ajustes';

  return (
    <div className="linha-phone" data-testid="linha-phone">
      <div className="linha-rail__mes">
        <button
          type="button"
          className="linha-icon-btn"
          aria-label={t('ui.previousMonth')}
          onClick={() => onMesChange(shiftMes(mes, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="linha-rail__mes-label">{mesTitulo(mes)}</span>
        <button
          type="button"
          className="linha-icon-btn"
          aria-label={t('ui.nextMonth')}
          onClick={() => onMesChange(shiftMes(mes, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {linhasError ? (
        <QueryErrorCard onRetry={onRetry} />
      ) : (
        <>
          <ul className="linha-phone__clientes" aria-label={t('phone.clientes')}>
            {ordenados.map((c) => {
              const l = linhaPorCliente.get(c.id!);
              const ativo = c.id === selectedId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`linha-phone__cliente${ativo ? ' is-active' : ''}`}
                    aria-current={ativo ? 'true' : undefined}
                    onClick={() => onSelect(c.id!)}
                  >
                    <ClienteFoto
                      srcs={fotosDe(c)}
                      className="linha-avatar"
                      fallback={
                        <span className="linha-avatar" style={{ background: c.cor }}>
                          {c.sigla}
                        </span>
                      }
                    />
                    <span className="linha-phone__cliente-nome">{c.nome}</span>
                    {l && !linhasLoading && (
                      <span className="linha-phone__cliente-meta">{contagemLinha(l)}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {!cliente ? (
            <div className="linha-empty">
              <p className="linha-empty__title">{t('shared.nenhumClienteTitulo')}</p>
              <p className="linha-empty__sub">{t('shared.nenhumClienteSub')}</p>
            </div>
          ) : linhasLoading ? (
            <div className="linha-empty">
              <Loader2 className="h-5 w-5 animate-spin" aria-label={t('shared.carregando')} />
            </div>
          ) : !linha ? (
            <div className="linha-empty">
              <p className="linha-empty__title">{t('shared.semLinhaNoMes')}</p>
              <p className="linha-empty__sub">{t('phone.semLinhaSub', { nome: cliente.nome })}</p>
            </div>
          ) : (
            <section
              className="linha-phone__linha"
              aria-label={t('phone.linhaDe', { nome: cliente.nome })}
            >
              <div className="linha-phone__topo">
                <h2 className="linha-header__title">{cliente.nome}</h2>
                <LinhaStatusBadge status={linha.status} />
              </div>
              {itensError ? (
                <QueryErrorCard onRetry={onRetry} />
              ) : itensLoading ? (
                <div className="linha-empty">
                  <Loader2 className="h-5 w-5 animate-spin" aria-label={t('shared.carregando')} />
                </div>
              ) : itens.length === 0 ? (
                <p className="linha-vazio">{t('phone.vazio')}</p>
              ) : (
                <ul className="linha-phone__cards">
                  {itens.map((item) => {
                    const n = comentariosPorItem.get(item.id) ?? 0;
                    return (
                      <li
                        key={item.id}
                        className="linha-phone__card"
                        data-testid="linha-phone-card"
                      >
                        <div className="linha-phone__card-topo">
                          <span className="linha-phone__data">
                            {item.data
                              ? format(parseISO(item.data), t('phone.dayMonthFormat'), {
                                  locale: dateLocale,
                                })
                              : t('shared.semData')}
                          </span>
                          <FormatoPill tipo={item.tipo} />
                          <LinhaAprovacaoChip item={item} rodada={linha.rodada} />
                          {n > 0 && (
                            <span
                              className="linha-bubble linha-phone__bubble"
                              aria-label={t('shared.comentarios', { count: n })}
                            >
                              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                              {n}
                            </span>
                          )}
                        </div>
                        <p className="linha-phone__titulo">
                          {item.titulo || t('shared.semTitulo')}
                        </p>
                        {item.direcao.trim() && (
                          <p className="linha-phone__direcao">{item.direcao}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="linha-phone__nota">{t('phone.notaComputador')}</p>
              {mostraEnviar && (
                <button
                  type="button"
                  className="linha-btn linha-btn--primary linha-phone__enviar"
                  disabled={!podeEnviar}
                  onClick={onEnviar}
                >
                  {enviando ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {t('shared.enviarAoCliente')}
                </button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
