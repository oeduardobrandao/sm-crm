import { useEffect, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarX2 } from 'lucide-react';
import { CONVITE_INDISPONIVEL, conviteIcsUrl, responderConvite } from '../api';
import { conviteQuery } from '../queries';
import { useTheme } from '../hooks/useTheme';
import { DEFAULT_HUB_THEME, resolveHubTheme } from '../theme';
import type { ConviteItem, ConviteResponse } from '../types';
import { AgendaCardView, localeDe } from './agenda/AgendaCardView';
import { agruparPorDia, compararInicio, formatarDiaTitulo } from './agenda/formatar';
import { ConviteMarca } from './convite/ConviteMarca';

const TOKEN_RE = /^[0-9a-f]{64}$/;

function parseOcorrencia(valor: string | null): number | null {
  const n = parseInt(valor ?? '', 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

/**
 * Public guest invite: `/convite/:token`, outside HubShell (no portal token, no bootstrap).
 * The guest confirms or declines each date; rescheduling stays with the client.
 */
export function ConvitePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const alvo = parseOcorrencia(searchParams.get('ocorrencia'));
  const { t, i18n } = useTranslation('hubConvite');
  const locale = localeDe(i18n.language);
  const { theme } = useTheme();
  const tokenValido = TOKEN_RE.test(token);

  const query = useQuery({ ...conviteQuery(token), enabled: tokenValido });
  const dados = query.data;
  const indisponivel =
    !tokenValido || (query.isError && query.error.message === CONVITE_INDISPONIVEL);

  useEffect(() => {
    if (!dados) return;
    const anterior = document.title;
    document.title = `${dados.titulo} | ${dados.workspace.nome}`;
    return () => {
      document.title = anterior;
    };
  }, [dados]);

  // Outside HubShell, so the page applies the workspace accent itself, before paint.
  const vars = resolveHubTheme(
    { ...DEFAULT_HUB_THEME, accent: dados?.workspace.brand_color ?? null },
    theme === 'dark',
  ).vars;
  const styleText = Object.entries(vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');

  let corpo: ReactNode;
  if (indisponivel) {
    corpo = (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <CalendarX2 size={28} className="hub-tx3 mb-4" aria-hidden="true" />
        <h1 className="font-display text-[22px] font-medium tracking-tight hub-txt mb-1.5">
          {t('indisponivel.titulo', 'Este convite não está mais disponível.')}
        </h1>
        <p className="text-sm hub-tx2 max-w-sm">
          {t(
            'indisponivel.descricao',
            'O evento pode ter sido cancelado ou o convite removido. Fale com quem convidou você.',
          )}
        </p>
      </div>
    );
  } else if (dados) {
    corpo = <Convite dados={dados} token={token} alvo={alvo} locale={locale} />;
  } else if (query.isError) {
    corpo = (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h1 className="font-display text-[20px] font-medium tracking-tight hub-txt mb-4">
          {t('erro.titulo', 'Não foi possível carregar o convite.')}
        </h1>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="px-4 py-2 rounded-[var(--hub-r-ctl)] hub-btn-primary text-sm font-semibold"
        >
          {t('erro.retry', 'Tentar novamente')}
        </button>
      </div>
    );
  } else {
    corpo = (
      <div className="flex justify-center py-24">
        <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
      </div>
    );
  }

  // .hub-root in every state: useTheme sets data-theme on it, and the hub-* rules are scoped to it.
  return (
    <>
      <style>{`:root { ${styleText} }`}</style>
      <div className="hub-root min-h-screen">
        <main className="hub-noise mx-auto w-full max-w-2xl px-5 sm:px-8 py-10 sm:py-14">
          {corpo}
        </main>
      </div>
    </>
  );
}

function Convite({
  dados,
  token,
  alvo,
  locale,
}: {
  dados: ConviteResponse;
  token: string;
  alvo: number | null;
  locale: string;
}) {
  const { t } = useTranslation('hubConvite');
  const qc = useQueryClient();
  // One "now" per render so every card and both sections agree on past/future.
  const agora = Date.now();
  const itens = [...dados.itens].sort(compararInicio);
  const proximos = itens.filter((i) => Date.parse(i.fim) > agora);
  const anteriores = itens.filter((i) => Date.parse(i.fim) <= agora);

  // useMutation (not a bare await) so queryClient.isMutating() holds the silent deploy swap.
  const responder = useMutation({
    mutationFn: (v: { ocorrenciaId: number; resposta: 'sim' | 'nao'; inicioVisto: string }) =>
      responderConvite(token, v.ocorrenciaId, v.resposta, v.inicioVisto),
    onSuccess: ({ item }) =>
      qc.setQueryData<ConviteResponse>(['convite', token], (old) =>
        old
          ? {
              ...old,
              itens: old.itens.map((i) => (i.ocorrencia_id === item.ocorrencia_id ? item : i)),
            }
          : old,
      ),
    // Moved (409), ended (409) or gone (404): the card shows the message, the page reloads.
    onError: () => void qc.invalidateQueries({ queryKey: ['convite', token] }),
  });

  const rotulos = {
    seloSim: t('selo.sim', 'Você confirmou'),
    seloNao: t('selo.nao', 'Você recusou'),
    seloAguardando: t('selo.aguardando', 'Aguardando sua resposta'),
    seloSemResposta: t('selo.semResposta', 'Sem resposta'),
  };

  const grupos = (lista: ConviteItem[]) =>
    agruparPorDia(lista).map((g) => (
      <section key={g.dia} aria-label={formatarDiaTitulo(g.dia, locale)} className="space-y-2.5">
        <h3 className="text-[12.5px] font-semibold uppercase tracking-wide hub-tx3">
          {formatarDiaTitulo(g.dia, locale)}
        </h3>
        {g.itens.map((item) => (
          <AgendaCardView
            key={item.ocorrencia_id}
            item={item}
            agora={agora}
            highlighted={item.ocorrencia_id === alvo}
            rotulos={rotulos}
            icsUrl={conviteIcsUrl(token, item.ocorrencia_id)}
            onResponder={async (resposta, inicioVisto) => {
              await responder.mutateAsync({
                ocorrenciaId: item.ocorrencia_id,
                resposta,
                inicioVisto,
              });
            }}
          />
        ))}
      </section>
    ));

  const organizador = dados.organizador_nome?.trim() || dados.workspace.nome;

  return (
    <div className="hub-fade-up">
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-6">
          <ConviteMarca nome={dados.workspace.nome} logoUrl={dados.workspace.logo_url} />
          <span className="text-[14px] font-semibold hub-txt">{dados.workspace.nome}</span>
        </div>
        <p className="text-[13px] font-medium hub-tx3 mb-1.5">
          {t('cabecalho.de', 'Convite de {{nome}}', { nome: organizador })}
        </p>
        <h1 className="font-display font-medium text-[clamp(1.75rem,5vw,2.5rem)] leading-[1.08] tracking-tight hub-txt break-words">
          {dados.titulo}
        </h1>
        <p className="text-[14px] hub-tx2 mt-2">
          {t('cabecalho.instrucao', 'Confirme ou recuse cada data abaixo.')}
        </p>
      </header>

      {itens.length === 0 ? (
        <p className="hub-card px-4 py-3 text-[13.5px] hub-tx2">
          {t('vazio', 'Nenhuma data para responder neste convite.')}
        </p>
      ) : (
        <div className="space-y-8">
          {proximos.length > 0 && <div className="space-y-5">{grupos(proximos)}</div>}
          {anteriores.length > 0 && (
            <div className="space-y-5">
              <h2 className="font-semibold text-[16px] tracking-tight hub-txt">
                {t('secoes.anteriores', 'Já aconteceram')}
              </h2>
              {grupos(anteriores)}
            </div>
          )}
        </div>
      )}

      <footer className="pt-12 pb-2 text-center text-[12px] hub-tx3">
        {t('rodape', 'Enviado pela Mesaas em nome de {{workspace}}.', {
          workspace: dados.workspace.nome,
        })}
      </footer>
    </div>
  );
}
