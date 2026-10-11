import { useMemo } from 'react';
import { addDays, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { AgendaOcorrencia } from '../../../../store/agenda';
import { IconeDaCamada } from '../../camadas/icones';
import { CAMADA_ROTULO, type CamadaItem } from '../../camadas/tipos';
import { MesGridPhone } from '../../phone/MesGridPhone';
import { TIPO_LABEL } from '../agendaLogic';
import { itensDoDia, paraItens, type ItemAgenda } from './itensAgenda';
import type { EventInput } from '@fullcalendar/core';

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const hora = (d: Date) => format(d, 'HH:mm');

/** "Segunda, 5 de outubro". */
export function diaComSemana(d: Date): string {
  const semana = format(d, 'EEEE', { locale: ptBR }).replace('-feira', '');
  return `${maiuscula(semana)}, ${format(d, "d 'de' MMMM", { locale: ptBR })}`;
}

const aguardandoResposta = (o: AgendaOcorrencia, meuId: string | null) =>
  !o.mascarado && o.organizador_id !== meuId && o.minha_resposta === 'pendente';

export interface AbrirItem {
  onEvento: (o: AgendaOcorrencia) => void;
  onCamada: (item: CamadaItem) => void;
}

/** One row of the phone Agenda lists (FAgenda): times, the event's colour bar or the
 *  layer's dashed icon, title and one line of context. Tapping opens its sheet. */
function LinhaAgenda({
  item,
  dia,
  meuId,
  abrir,
}: {
  item: ItemAgenda;
  dia: Date;
  meuId: string | null;
  abrir: AbrirItem;
}) {
  const o = item.ocorrencia;
  const camada = item.camada;
  const pendente = o ? aguardandoResposta(o, meuId) : false;
  const recusado = o && !o.mascarado && o.organizador_id !== meuId && o.minha_resposta === 'nao';
  const inicioNoDia = item.inicio >= dia;
  const contexto = camada
    ? CAMADA_ROTULO[camada.camada]
    : o && !o.mascarado
      ? [
          pendente ? 'Aguardando sua resposta' : null,
          o.cliente_nome || (o.tipo ? TIPO_LABEL[o.tipo] : null),
          o.local,
        ]
          .filter(Boolean)
          .join(' · ')
      : '';
  const soInicio = camada?.camada === 'posts' || item.fim.getTime() === item.inicio.getTime();

  return (
    <li className="phone-agenda-row">
      <button
        type="button"
        className="phone-agenda-row__btn"
        onClick={() => (camada ? abrir.onCamada(camada) : o && abrir.onEvento(o))}
      >
        <span className="phone-agenda-row__hora">
          {item.diaInteiro ? (
            <strong>Dia inteiro</strong>
          ) : (
            <>
              <strong>{inicioNoDia ? hora(item.inicio) : '00:00'}</strong>
              {!soInicio && <span>{hora(item.fim)}</span>}
            </>
          )}
        </span>
        {camada ? (
          <span
            className="agenda-camada-swatch agenda-camada-swatch--lg phone-agenda-row__swatch"
            style={{ borderColor: item.cor, color: item.cor }}
            aria-hidden="true"
          >
            <IconeDaCamada item={camada} size={14} strokeWidth={2} />
          </span>
        ) : (
          <span
            className={cn(
              'phone-agenda-row__barra',
              pendente && 'phone-agenda-row__barra--pendente',
            )}
            style={{ borderColor: item.cor, background: pendente ? 'transparent' : item.cor }}
            aria-hidden="true"
          />
        )}
        <span className="phone-agenda-row__texto">
          <span
            className={cn(
              'phone-agenda-row__titulo',
              recusado && 'phone-agenda-row__titulo--recusado',
            )}
          >
            {item.titulo}
          </span>
          {contexto && <span className="phone-agenda-row__contexto">{contexto}</span>}
        </span>
      </button>
    </li>
  );
}

function GrupoDoDia({
  dia,
  itens,
  meuId,
  abrir,
}: {
  dia: Date;
  itens: ItemAgenda[];
  meuId: string | null;
  abrir: AbrirItem;
}) {
  return (
    <section className="phone-agenda-dia">
      <h2 className="phone-agenda-dia__titulo">{diaComSemana(dia)}</h2>
      <ul className="phone-agenda-dia__lista">
        {itens.map((i) => (
          <LinhaAgenda key={i.id} item={i} dia={dia} meuId={meuId} abrir={abrir} />
        ))}
      </ul>
    </section>
  );
}

/** Lista on phones: the week's days that have something, one card per day. */
export function AgendaListaPhone({
  inicio,
  fim,
  eventos,
  meuId,
  abrir,
}: {
  inicio: Date;
  /** Exclusive. */
  fim: Date;
  eventos: EventInput[];
  meuId: string | null;
  abrir: AbrirItem;
}) {
  const itens = useMemo(() => paraItens(eventos), [eventos]);
  const dias: { dia: Date; itens: ItemAgenda[] }[] = [];
  for (let d = inicio; d < fim; d = addDays(d, 1)) {
    const doDia = itensDoDia(itens, d);
    if (doDia.length) dias.push({ dia: d, itens: doDia });
  }
  if (dias.length === 0) return <p className="phone-agenda-vazio">Nenhum evento neste período.</p>;
  return (
    <div className="phone-agenda-lista">
      {dias.map(({ dia, itens: doDia }) => (
        <GrupoDoDia key={dia.toISOString()} dia={dia} itens={doDia} meuId={meuId} abrir={abrir} />
      ))}
    </div>
  );
}

/** Mês on phones: the compact month grid with one dot per colour, the selected day's
 *  list under it. */
export function AgendaMesPhone({
  mes,
  selecionado,
  onSelect,
  eventos,
  meuId,
  abrir,
}: {
  mes: Date;
  selecionado: Date;
  onSelect: (d: Date) => void;
  eventos: EventInput[];
  meuId: string | null;
  abrir: AbrirItem;
}) {
  const itens = useMemo(() => paraItens(eventos), [eventos]);
  const doDia = itensDoDia(itens, selecionado);
  return (
    <>
      <MesGridPhone
        mes={mes}
        weekStartsOn={1}
        selecionado={selecionado}
        onSelect={onSelect}
        dotsDoDia={(d) => [...new Set(itensDoDia(itens, d).map((i) => i.cor))]}
        resumoDoDia={(d) => {
          const n = itensDoDia(itens, d).length;
          return n ? `${n} ${n === 1 ? 'item' : 'itens'}` : '';
        }}
      />
      {doDia.length ? (
        <GrupoDoDia dia={selecionado} itens={doDia} meuId={meuId} abrir={abrir} />
      ) : (
        <p className="phone-agenda-vazio">Nenhum evento neste dia.</p>
      )}
    </>
  );
}
