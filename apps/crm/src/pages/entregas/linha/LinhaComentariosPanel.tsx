import { Fragment, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  responderComentario,
  type LinhaEditorial,
  type LinhaItem,
  type LinhaResposta,
} from '@/store/linhaEditorial';
import { linhaRespostasKey } from './useLinhaQueries';

interface LinhaComentariosPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linha: LinhaEditorial;
  /** The row whose thread is shown under the linha-level one; null shows only the latter. */
  item: LinhaItem | null;
  respostas: LinhaResposta[];
}

/** Key of the decision label shown next to the author; a plain comment has none. */
const ACAO_KEY: Record<LinhaResposta['acao'], string | null> = {
  comentario: null,
  aprovado: 'comentariosPanel.acaoAprovado',
  ajustes: 'comentariosPanel.acaoAjustes',
};

function Thread({ respostas, vazio }: { respostas: LinhaResposta[]; vazio: string }) {
  const { t } = useTranslation('linha');
  const dateLocale = useDateFnsLocale();
  if (respostas.length === 0) return <p className="linha-thread__vazio">{vazio}</p>;
  return (
    <ol className="linha-thread">
      {respostas.map((r, idx) => {
        const novaRodada = idx === 0 || respostas[idx - 1].rodada !== r.rodada;
        const acaoKey = ACAO_KEY[r.acao];
        const acao = acaoKey ? t(acaoKey) : null;
        return (
          <Fragment key={r.id}>
            {novaRodada && (
              <li className="linha-thread__rodada">
                <span>{t('comentariosPanel.rodada', { n: r.rodada })}</span>
              </li>
            )}
            <li className={`linha-msg${r.is_workspace_user ? ' linha-msg--equipe' : ''}`}>
              <div className="linha-msg__meta">
                <span className="linha-msg__autor">
                  {r.is_workspace_user
                    ? t('comentariosPanel.equipe')
                    : t('comentariosPanel.cliente')}
                </span>
                {acao && <span className="linha-msg__acao">{acao}</span>}
                <time dateTime={r.created_at}>
                  {format(new Date(r.created_at), t('comentariosPanel.dateTimeFormat'), {
                    locale: dateLocale,
                  })}
                </time>
              </div>
              {r.comentario?.trim() && <p className="linha-msg__texto">{r.comentario}</p>}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

/**
 * Side panel with the linha-level thread on top and, when opened from a row, that row's thread
 * (client comments, team replies and decisions, split by rodada). The reply goes to the row
 * thread when there is one, else to the linha. The draft survives a failed send.
 */
export function LinhaComentariosPanel({
  open,
  onOpenChange,
  linha,
  item,
  respostas,
}: LinhaComentariosPanelProps) {
  const { t } = useTranslation('linha');
  const qc = useQueryClient();
  const [rascunho, setRascunho] = useState('');
  const [enviando, setEnviando] = useState(false);

  const gerais = respostas.filter((r) => r.item_id === null);
  const doItem = item ? respostas.filter((r) => r.item_id === item.id) : [];
  const alvo = item
    ? t('comentariosPanel.alvoItem', { titulo: item.titulo.trim() || t('shared.semTituloLower') })
    : t('comentariosPanel.alvoLinha');

  const responder = async () => {
    const texto = rascunho.trim();
    if (!texto || enviando) return;
    setEnviando(true);
    try {
      await trackUnsavedWork(responderComentario(linha.id, item?.id ?? null, texto));
      setRascunho('');
      void qc.invalidateQueries({ queryKey: linhaRespostasKey(linha.id) });
    } catch {
      toast.error(t('comentariosPanel.erroEnviar'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="linha-panel">
        <SheetHeader>
          <SheetTitle>{t('comentariosPanel.titulo')}</SheetTitle>
          <SheetDescription>{t('comentariosPanel.descricao')}</SheetDescription>
        </SheetHeader>
        <div className="linha-panel__body">
          <section className="linha-panel__section" aria-label={t('shared.comentariosGerais')}>
            <h3 className="linha-panel__h">{t('comentariosPanel.sobreLinha')}</h3>
            <Thread respostas={gerais} vazio={t('comentariosPanel.vazioGeral')} />
          </section>
          {item && (
            <section className="linha-panel__section" aria-label={t('comentariosPanel.doPost')}>
              <h3 className="linha-panel__h">
                {item.titulo.trim() || t('comentariosPanel.postSemTitulo')}
              </h3>
              <Thread respostas={doItem} vazio={t('comentariosPanel.vazioPost')} />
            </section>
          )}
        </div>
        <form
          className="linha-panel__composer"
          onSubmit={(e) => {
            e.preventDefault();
            void responder();
          }}
        >
          <label className="linha-panel__label" htmlFor="linha-resposta">
            {t('comentariosPanel.resposta')}
          </label>
          <p id="linha-resposta-alvo" className="linha-panel__hint">
            {t('comentariosPanel.vaiPara', { alvo })}
          </p>
          <textarea
            id="linha-resposta"
            className="linha-input linha-input--multi linha-panel__textarea"
            aria-describedby="linha-resposta-alvo"
            rows={3}
            value={rascunho}
            placeholder={t('comentariosPanel.placeholder')}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void responder();
              }
            }}
          />
          <button
            type="submit"
            className="linha-btn linha-btn--primary"
            disabled={!rascunho.trim() || enviando}
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('comentariosPanel.responder')}
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
