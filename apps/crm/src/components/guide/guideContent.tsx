import type { ReactNode } from 'react';
import {
  Calendar,
  Columns,
  Crown,
  IdCard,
  Instagram,
  KeyRound,
  Link as LinkIcon,
  Pencil,
  Shield,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  GuideCheckList,
  GuideFine,
  GuideInfoBox,
  GuideOption,
  GuideOptionGrid,
  GuideStatusPill,
  GuideTip,
} from './guideBits';

export type SignalKey = 'hasCliente' | 'hasInstagram' | 'hasHubToken' | 'hasMembro' | 'hasWorkflow';

export interface GuideCtx {
  latestClienteId: number | null;
}

export interface GuideAction {
  label: string;
  caption: string;
  to(ctx: GuideCtx): string;
}

export interface GuideRecapItem {
  signal: SignalKey;
  label: string;
}

export interface GuidePage {
  id: string;
  title: string;
  lead: string;
  body?: ReactNode;
  /** Linhas de recap com check dinâmico pelo sinal (página de fechamento). */
  recap?: GuideRecapItem[];
  action?: GuideAction;
  /** Presente: a página conclui quando o sinal fica true. Ausente: conclui ao ser vista. */
  signal?: SignalKey;
  entitlementFlag?: string;
  bridgeTo?: 't2' | 't3';
  conclude?: boolean;
}

export interface GuideTrail {
  id: 't1' | 't2' | 't3';
  title: string;
  subtitle: string;
  icon: LucideIcon;
  pages: GuidePage[];
}

const clienteDeepLink = (suffix: string) => (ctx: GuideCtx) =>
  ctx.latestClienteId != null ? `/clientes/${ctx.latestClienteId}/${suffix}` : '/clientes';

export const GUIDE_TRAILS: GuideTrail[] = [
  {
    id: 't1',
    title: 'Adicionar seu primeiro cliente',
    subtitle: 'Cadastro, Instagram e link do Hub',
    icon: UserPlus,
    pages: [
      {
        id: 't1p1',
        title: 'Tudo começa com um cliente',
        lead: 'Cada cliente reúne cadastro, briefing, entregas e um portal próprio. É em volta dele que o Mesaas gira.',
        body: (
          <GuideTip>
            Dica: cadastre o seu próprio Instagram como primeiro cliente. Você aprende o caminho
            inteiro antes de trazer um cliente de verdade.
          </GuideTip>
        ),
      },
      {
        id: 't1p2',
        title: 'Crie o cadastro',
        lead: 'Só o nome é obrigatório. E-mail, telefone e valores podem esperar.',
        action: {
          label: 'Fazer agora',
          caption:
            'Abre seus clientes com o cadastro pronto para preencher. O guia continua de onde parou.',
          to: () => '/clientes?novo=1',
        },
        signal: 'hasCliente',
      },
      {
        id: 't1p3',
        title: 'Conecte o Instagram do cliente',
        lead: 'Com a conta conectada, você agenda, publica e acompanha métricas direto pelo Mesaas. Dois caminhos:',
        body: (
          <GuideOptionGrid columns={2}>
            <GuideOption icon={Instagram} title="Você conecta agora">
              Entre com a conta do cliente pelo login da Meta.
            </GuideOption>
            <GuideOption icon={LinkIcon} title="O cliente conecta sozinho">
              Envie um link seguro, válido por 30 dias. Ele conecta sem senha e sem login no Mesaas.
            </GuideOption>
          </GuideOptionGrid>
        ),
        action: {
          label: 'Fazer agora',
          caption: 'Abre a aba Redes sociais do cliente que você criou.',
          to: clienteDeepLink('redes-sociais'),
        },
        signal: 'hasInstagram',
      },
      {
        id: 't1p4',
        title: 'Gere o link do Hub',
        lead: 'O Hub é o portal do seu cliente: aprovações, postagens e briefing com a sua marca. Sem login e sem senha.',
        body: (
          <GuideFine>
            O link renova a validade a cada visita do cliente. Você pode desativar ou trocar quando
            quiser.
          </GuideFine>
        ),
        action: {
          label: 'Fazer agora',
          caption: 'Abre a aba Hub do cliente para gerar e copiar o link.',
          to: clienteDeepLink('hub'),
        },
        signal: 'hasHubToken',
        entitlementFlag: 'feature_hub_portal',
      },
      {
        id: 't1p5',
        title: 'Primeiro cliente pronto',
        lead: 'É esse caminho para cada cliente novo. Agora, quem trabalha com você?',
        recap: [
          { signal: 'hasCliente', label: 'Cadastro criado' },
          { signal: 'hasInstagram', label: 'Instagram conectado' },
          { signal: 'hasHubToken', label: 'Link do Hub gerado' },
        ],
        bridgeTo: 't2',
      },
    ],
  },
  {
    id: 't2',
    title: 'Montar sua equipe',
    subtitle: 'Membros, papéis de acesso e tarefas',
    icon: Users,
    pages: [
      {
        id: 't2p1',
        title: 'Membro é uma coisa, acesso é outra',
        lead: 'Essa separação deixa o controle simples:',
        body: (
          <>
            <GuideOptionGrid columns={2}>
              <GuideOption icon={IdCard} title="Membro">
                O registro de quem trabalha com você: cargo, tipo de contrato, custos.
              </GuideOption>
              <GuideOption icon={KeyRound} title="Acesso">
                Um convite por e-mail para a pessoa entrar no Mesaas. Opcional.
              </GuideOption>
            </GuideOptionGrid>
            <GuideFine>
              Dá para ter membro sem acesso: um freelancer que você só gerencia, por exemplo.
            </GuideFine>
          </>
        ),
      },
      {
        id: 't2p2',
        title: 'Três papéis de acesso',
        lead: 'O papel define o que a pessoa vê e faz.',
        body: (
          <>
            <GuideOptionGrid columns={3}>
              <GuideOption icon={Crown} title="Dono">
                Tudo, inclusive planos, cobrança e financeiro.
              </GuideOption>
              <GuideOption icon={Shield} title="Admin">
                Gerencia clientes, equipe e entregas.
              </GuideOption>
              <GuideOption icon={Pencil} title="Agente">
                Trabalha nas entregas e tarefas. Sem financeiro.
              </GuideOption>
            </GuideOptionGrid>
            <GuideFine>Você é o dono do workspace. Convites saem como admin ou agente.</GuideFine>
          </>
        ),
      },
      {
        id: 't2p3',
        title: 'Adicione alguém da equipe',
        lead: 'O convite mora no cadastro do membro: crie, ative o convite e escolha o papel.',
        action: {
          label: 'Fazer agora',
          caption: 'Abre a Equipe com o cadastro de membro aberto.',
          to: () => '/equipe?novo=1',
        },
        signal: 'hasMembro',
      },
      {
        id: 't2p4',
        title: 'O dia a dia vive nas Tarefas',
        lead: 'Distribua o trabalho: cada tarefa tem responsável e prazo, e cada post tem os seus responsáveis.',
        bridgeTo: 't3',
      },
    ],
  },
  {
    id: 't3',
    title: 'Criar suas entregas',
    subtitle: 'Fluxos, posts, status e agendamento',
    icon: Columns,
    pages: [
      {
        id: 't3p1',
        title: 'Três palavras resolvem as Entregas',
        lead: 'Fluxo, etapas e posts. O resto deriva delas.',
        body: (
          <>
            <GuideInfoBox>
              <b>Fluxo</b> · o ciclo de trabalho de um cliente, o card do kanban. Ex.: Posts de
              setembro
              <br />
              <b>Etapas</b> · as fases do fluxo; só uma fica ativa por vez
              <br />
              <b>Posts</b> · o conteúdo em si; cada um com o próprio status
            </GuideInfoBox>
            <GuideFine>Modelo: a receita reutilizável que cria fluxos iguais todo mês.</GuideFine>
          </>
        ),
      },
      {
        id: 't3p2',
        title: 'Crie o primeiro fluxo',
        lead: 'O assistente monta tudo: escolha um modelo pronto, diga o cliente e pronto.',
        body: (
          <GuideOptionGrid columns={3}>
            <GuideOption icon={Calendar} title="Posts mensais">
              Ciclo recorrente por mês.
            </GuideOption>
            <GuideOption icon={Columns} title="Outros modelos">
              Reels, campanhas, branding.
            </GuideOption>
            <GuideOption icon={Pencil} title="Do zero">
              Monte as suas etapas.
            </GuideOption>
          </GuideOptionGrid>
        ),
        action: {
          label: 'Fazer agora',
          caption: 'Abre o assistente de novo fluxo nas Entregas.',
          to: () => '/entregas?novo-fluxo=1',
        },
        signal: 'hasWorkflow',
      },
      {
        id: 't3p3',
        title: 'O post reúne tudo',
        lead: 'Dentro do fluxo, cada post junta a mídia, quem faz e a legenda.',
        body: (
          <GuideInfoBox>
            Anexe imagens e vídeos, defina responsáveis e escreva a legenda no próprio post. Tudo em
            um lugar só, pronto para aprovação.
          </GuideInfoBox>
        ),
      },
      {
        id: 't3p4',
        title: 'Status contam a história',
        lead: 'O post anda por status até o publicado. E você pode criar os seus.',
        body: (
          <>
            <div
              style={{
                display: 'flex',
                gap: 6,
                marginTop: 14,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <GuideStatusPill>Rascunho</GuideStatusPill>
              <GuideStatusPill>Revisão interna</GuideStatusPill>
              <GuideStatusPill>Enviado ao cliente</GuideStatusPill>
              <GuideStatusPill tone="success">Aprovado pelo cliente</GuideStatusPill>
              <GuideStatusPill tone="warning">Agendado</GuideStatusPill>
              <GuideStatusPill tone="success">Postado</GuideStatusPill>
            </div>
            <GuideFine>
              Crie status personalizados, com automações: por exemplo, avisar a equipe quando um
              post for aprovado.
            </GuideFine>
          </>
        ),
      },
      {
        id: 't3p5',
        title: 'O que um post precisa para ser agendado',
        lead: 'O Mesaas confere tudo isso antes de enviar ao Instagram. Se faltar algo, o botão Agendar mostra o que é.',
        body: (
          <>
            <GuideCheckList
              items={[
                <>
                  Status <GuideStatusPill tone="success">Aprovado pelo cliente</GuideStatusPill>
                </>,
                'Data e hora pelo menos 10 minutos no futuro',
                'Legenda do Instagram escrita (stories dispensam)',
                'Pelo menos uma mídia dentro dos limites',
                'Conta do Instagram do cliente conectada',
              ]}
            />
            <GuideInfoBox>
              <b>Limites de mídia</b> · imagens JPEG, PNG ou WebP até 8 MB · vídeos MP4 ou MOV de 3
              a 90 s, até 250 MB · carrossel com até 10 itens
            </GuideInfoBox>
          </>
        ),
      },
      {
        id: 't3p6',
        title: 'Pronto para rodar',
        lead: 'Cliente, equipe e entregas: o essencial está de pé. Depois, explore o Calendário, o Analytics e os Relatórios.',
        conclude: true,
      },
    ],
  },
];

export function filterTrails(hasFeature: (flag: string) => boolean): GuideTrail[] {
  return GUIDE_TRAILS.map((t) => ({
    ...t,
    pages: t.pages.filter((p) => !p.entitlementFlag || hasFeature(p.entitlementFlag)),
  })).filter((t) => t.pages.length > 0);
}

export function allPages(trails: GuideTrail[]): GuidePage[] {
  return trails.flatMap((t) => t.pages);
}

/** Sinais que a regra de auto-conclusão exige: só os das páginas presentes. */
export function requiredSignals(trails: GuideTrail[]): SignalKey[] {
  const keys: SignalKey[] = [];
  for (const p of allPages(trails)) {
    if (p.signal && !keys.includes(p.signal)) keys.push(p.signal);
  }
  return keys;
}
