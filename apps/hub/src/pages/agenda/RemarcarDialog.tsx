import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import { remarcarAgenda } from '../../api';
import { setHubAgendaItem } from '../../queries';
import { HubDialog } from '../../components/ui/HubDialog';
import type { HubAgendaItem } from '../../types';
import { diaLocal, paredeNoFuso, rotuloFuso, sugestaoNoPassado } from './formatar';

const MAX_MENSAGEM = 1000;

const CAMPO =
  'w-full border rounded-lg px-3 py-2 text-sm outline-none hub-bg-card hub-txt placeholder:text-[var(--hub-tx3)] hub-focus-accent focus:ring-2 hub-border';

interface RemarcarDialogProps {
  item: HubAgendaItem;
  token: string;
  onClose: () => void;
  /** A server refusal (moved, ended, already pending): the caller reloads the list. */
  onErro: () => void;
}

/**
 * "Pedir para remarcar". Date and time are typed and sent as wall time in the
 * occurrence's own tz (not the browser's): the RPC converts them in the series
 * tz and keeps the duration. All-day occurrences have no time field.
 */
export function RemarcarDialog({ item, token, onClose, onErro }: RemarcarDialogProps) {
  const { t } = useTranslation('hubAgenda');
  const qc = useQueryClient();
  const atual = item.dia_inteiro
    ? { data: diaLocal(item), hora: null }
    : paredeNoFuso(item.inicio, item.tz);
  const [data, setData] = useState(atual.data);
  const [hora, setHora] = useState<string>(atual.hora ?? '');
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const fuso = item.dia_inteiro ? null : rotuloFuso(item.tz);

  const remarcar = useMutation({
    mutationFn: (v: { data: string; hora: string | null; mensagem: string }) =>
      remarcarAgenda(token, item.ocorrencia_id, v.data, v.hora, v.mensagem),
    onSuccess: (r) => {
      setHubAgendaItem(qc, token, r.item);
      onClose();
    },
    onError: (e: Error) => {
      setErro(e.message || t('erros.generico', 'Não foi possível salvar. Tente novamente.'));
      onErro();
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const h = item.dia_inteiro ? null : hora;
    if (!data || (!item.dia_inteiro && !h)) {
      setErro(t('remarcar.erroObrigatorio', 'Informe a nova data e o horário.'));
      return;
    }
    if (data === atual.data && h === atual.hora) {
      setErro(t('remarcar.erroIgual', 'Escolha uma data ou horário diferente do atual.'));
      return;
    }
    if (sugestaoNoPassado(data, h, item.tz)) {
      setErro(t('remarcar.erroPassado', 'Escolha um horário no futuro.'));
      return;
    }
    remarcar.mutate({ data, hora: h, mensagem: mensagem.trim() });
  }

  const fechar = () => {
    if (!remarcar.isPending) onClose();
  };

  return (
    <HubDialog open onRequestClose={fechar} title={t('remarcar.tituloDialogo', 'Remarcar evento')}>
      {/* Bottom sheet on phones, centered card from md up. */}
      <form
        onSubmit={enviar}
        noValidate
        className="hub-bg-card w-full self-end md:self-center md:w-[min(460px,calc(100vw-3rem))] rounded-t-2xl md:rounded-xl shadow-2xl p-5 sm:p-6 space-y-4 max-h-[calc(100dvh-1rem)] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold hub-txt">
              {t('remarcar.titulo', 'Pedir para remarcar')}
            </h2>
            <p className="text-[13px] hub-tx3 mt-0.5 break-words">{item.titulo}</p>
          </div>
          <button
            type="button"
            aria-label={t('remarcar.fechar', 'Fechar')}
            onClick={fechar}
            className="hub-icon-btn p-1.5 rounded-md transition-colors hub-tx3"
          >
            <X size={18} />
          </button>
        </div>

        <div className={item.dia_inteiro ? '' : 'grid grid-cols-2 gap-3'}>
          <div>
            <label
              htmlFor="remarcar-data"
              className="text-[12.5px] font-semibold hub-tx2 mb-1 block"
            >
              {t('remarcar.data', 'Nova data')}
            </label>
            <input
              id="remarcar-data"
              type="date"
              required
              className={CAMPO}
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </div>
          {!item.dia_inteiro && (
            <div>
              <label
                htmlFor="remarcar-hora"
                className="text-[12.5px] font-semibold hub-tx2 mb-1 block"
              >
                {t('remarcar.hora', 'Novo horário')}
              </label>
              <input
                id="remarcar-hora"
                type="time"
                required
                className={CAMPO}
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
            </div>
          )}
        </div>
        {fuso && (
          <p className="text-[12px] hub-tx3 -mt-2">
            {t('remarcar.fuso', 'Horário no fuso do evento ({{fuso}}).', { fuso })}
          </p>
        )}
        {item.dia_inteiro && (
          <p className="text-[12px] hub-tx3 -mt-2">
            {t('remarcar.diaInteiro', 'Evento de dia inteiro: escolha só a nova data.')}
          </p>
        )}

        <div>
          <label
            htmlFor="remarcar-mensagem"
            className="text-[12.5px] font-semibold hub-tx2 mb-1 block"
          >
            {t('remarcar.mensagem', 'Mensagem para a equipe (opcional)')}
          </label>
          <textarea
            id="remarcar-mensagem"
            maxLength={MAX_MENSAGEM}
            className={`${CAMPO} resize-none min-h-[88px]`}
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            placeholder={t('remarcar.mensagemPh', 'Ex: Nesse dia estou viajando.')}
          />
        </div>

        {erro && (
          <p role="alert" className="text-[13px] font-medium text-red-600">
            {erro}
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={fechar}
            className="px-4 py-2.5 rounded-[var(--hub-r-ctl)] hub-btn-secondary text-sm font-semibold"
          >
            {t('remarcar.cancelar', 'Voltar')}
          </button>
          <button
            type="submit"
            disabled={remarcar.isPending}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-[var(--hub-r-ctl)] hub-btn-primary text-sm font-semibold disabled:opacity-50"
          >
            {remarcar.isPending && (
              <Loader2 size={15} className="animate-spin" aria-hidden="true" />
            )}
            {t('remarcar.enviar', 'Enviar pedido')}
          </button>
        </div>
      </form>
    </HubDialog>
  );
}
