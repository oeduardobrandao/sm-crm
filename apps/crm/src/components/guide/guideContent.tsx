import type { ReactNode } from 'react';
import { i18n } from '@mesaas/i18n';
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
  /** Slug de um vídeo da Central de Ajuda mostrado nesta página. Sem vídeo publicado com esse
   * slug, a página fica sem card. */
  videoSlug?: string;
  /** Linhas de recap com check dinâmico pelo sinal (página de fechamento). */
  recap?: GuideRecapItem[];
  action?: GuideAction;
  /** Presente: a página conclui quando o sinal fica true. Ausente: conclui ao ser vista. */
  signal?: SignalKey;
  entitlementFlag?: string;
  /** Escondida quando o plano tem o limite abaixo do mínimo (ex.: Free tem 0 links de portal e 1
   * usuário). Só vale com os limites carregados e finitos; `null` no limite é ilimitado. */
  minLimit?: { key: 'max_hub_tokens' | 'max_team_members'; min: number };
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

/** Vídeo em destaque na tela inicial do guia. */
export const GUIDE_HOME_VIDEO = 'primeiro-acesso';
/** Série sugerida na página de fechamento. */
export const GUIDE_MORE_SERIES = 'indo-alem';

const clienteDeepLink = (suffix: string) => (ctx: GuideCtx) =>
  ctx.latestClienteId != null ? `/clientes/${ctx.latestClienteId}/${suffix}` : '/clientes';

const tg = (key: string): string => i18n.t(`guide:${key}`);
const doNow = () => tg('action.doNow');

/**
 * Structure (ids, icons, signals, video slugs, deep links) lives here; every visible string is a
 * getter that resolves through i18n when the page reads it, so nothing is frozen at module load
 * and a language change shows on the next render. `filterTrails` keeps the getters alive by
 * deriving trails with `Object.create` instead of spreading them.
 */
export const GUIDE_TRAILS: GuideTrail[] = [
  {
    id: 't1',
    get title() {
      return tg('t1.title');
    },
    get subtitle() {
      return tg('t1.subtitle');
    },
    icon: UserPlus,
    pages: [
      {
        id: 't1p1',
        get title() {
          return tg('t1.p1.title');
        },
        get lead() {
          return tg('t1.p1.lead');
        },
        get body() {
          return <GuideTip>{tg('t1.p1.tip')}</GuideTip>;
        },
      },
      {
        id: 't1p2',
        get title() {
          return tg('t1.p2.title');
        },
        videoSlug: 'cadastrar-cliente',
        get lead() {
          return tg('t1.p2.lead');
        },
        action: {
          get label() {
            return doNow();
          },
          get caption() {
            return tg('t1.p2.caption');
          },
          to: () => '/clientes?novo=1',
        },
        signal: 'hasCliente',
      },
      {
        id: 't1p3',
        get title() {
          return tg('t1.p3.title');
        },
        videoSlug: 'conectar-instagram',
        get lead() {
          return tg('t1.p3.lead');
        },
        get body() {
          return (
            <GuideOptionGrid columns={2}>
              <GuideOption icon={Instagram} title={tg('t1.p3.optionNowTitle')}>
                {tg('t1.p3.optionNowText')}
              </GuideOption>
              <GuideOption icon={LinkIcon} title={tg('t1.p3.optionClientTitle')}>
                {tg('t1.p3.optionClientText')}
              </GuideOption>
            </GuideOptionGrid>
          );
        },
        action: {
          get label() {
            return doNow();
          },
          get caption() {
            return tg('t1.p3.caption');
          },
          to: clienteDeepLink('redes-sociais'),
        },
        signal: 'hasInstagram',
      },
      {
        id: 't1p4',
        get title() {
          return tg('t1.p4.title');
        },
        videoSlug: 'portal-do-cliente',
        get lead() {
          return tg('t1.p4.lead');
        },
        get body() {
          return <GuideFine>{tg('t1.p4.fine')}</GuideFine>;
        },
        action: {
          get label() {
            return doNow();
          },
          get caption() {
            return tg('t1.p4.caption');
          },
          to: clienteDeepLink('hub/acesso'),
        },
        signal: 'hasHubToken',
        entitlementFlag: 'feature_hub_portal',
        minLimit: { key: 'max_hub_tokens', min: 1 },
      },
      {
        id: 't1p5',
        get title() {
          return tg('t1.p5.title');
        },
        get lead() {
          return tg('t1.p5.lead');
        },
        recap: [
          {
            signal: 'hasCliente',
            get label() {
              return tg('t1.p5.recapCliente');
            },
          },
          {
            signal: 'hasInstagram',
            get label() {
              return tg('t1.p5.recapInstagram');
            },
          },
          {
            signal: 'hasHubToken',
            get label() {
              return tg('t1.p5.recapHub');
            },
          },
        ],
        bridgeTo: 't2',
      },
    ],
  },
  {
    id: 't2',
    get title() {
      return tg('t2.title');
    },
    get subtitle() {
      return tg('t2.subtitle');
    },
    icon: Users,
    pages: [
      {
        id: 't2p1',
        get title() {
          return tg('t2.p1.title');
        },
        get lead() {
          return tg('t2.p1.lead');
        },
        get body() {
          return (
            <>
              <GuideOptionGrid columns={2}>
                <GuideOption icon={IdCard} title={tg('t2.p1.memberTitle')}>
                  {tg('t2.p1.memberText')}
                </GuideOption>
                <GuideOption icon={KeyRound} title={tg('t2.p1.accessTitle')}>
                  {tg('t2.p1.accessText')}
                </GuideOption>
              </GuideOptionGrid>
              <GuideFine>{tg('t2.p1.fine')}</GuideFine>
            </>
          );
        },
      },
      {
        id: 't2p2',
        get title() {
          return tg('t2.p2.title');
        },
        get lead() {
          return tg('t2.p2.lead');
        },
        get body() {
          return (
            <>
              <GuideOptionGrid columns={3}>
                <GuideOption icon={Crown} title={tg('t2.p2.ownerTitle')}>
                  {tg('t2.p2.ownerText')}
                </GuideOption>
                <GuideOption icon={Shield} title={tg('t2.p2.adminTitle')}>
                  {tg('t2.p2.adminText')}
                </GuideOption>
                <GuideOption icon={Pencil} title={tg('t2.p2.agentTitle')}>
                  {tg('t2.p2.agentText')}
                </GuideOption>
              </GuideOptionGrid>
              <GuideFine>{tg('t2.p2.fine')}</GuideFine>
            </>
          );
        },
      },
      {
        id: 't2p3',
        get title() {
          return tg('t2.p3.title');
        },
        videoSlug: 'cadastrar-equipe',
        get lead() {
          return tg('t2.p3.lead');
        },
        action: {
          get label() {
            return doNow();
          },
          get caption() {
            return tg('t2.p3.caption');
          },
          to: () => '/equipe?novo=1',
        },
        signal: 'hasMembro',
        minLimit: { key: 'max_team_members', min: 2 },
      },
      {
        id: 't2p4',
        get title() {
          return tg('t2.p4.title');
        },
        get lead() {
          return tg('t2.p4.lead');
        },
        bridgeTo: 't3',
      },
    ],
  },
  {
    id: 't3',
    get title() {
      return tg('t3.title');
    },
    get subtitle() {
      return tg('t3.subtitle');
    },
    icon: Columns,
    pages: [
      {
        id: 't3p1',
        get title() {
          return tg('t3.p1.title');
        },
        get lead() {
          return tg('t3.p1.lead');
        },
        get body() {
          return (
            <>
              <GuideInfoBox>
                <b>{tg('t3.p1.flowLabel')}</b> · {tg('t3.p1.flowText')}
                <br />
                <b>{tg('t3.p1.stagesLabel')}</b> · {tg('t3.p1.stagesText')}
                <br />
                <b>{tg('t3.p1.postsLabel')}</b> · {tg('t3.p1.postsText')}
              </GuideInfoBox>
              <GuideFine>{tg('t3.p1.fine')}</GuideFine>
            </>
          );
        },
      },
      {
        id: 't3p2',
        get title() {
          return tg('t3.p2.title');
        },
        videoSlug: 'criar-fluxo',
        get lead() {
          return tg('t3.p2.lead');
        },
        get body() {
          return (
            <GuideOptionGrid columns={3}>
              <GuideOption icon={Calendar} title={tg('t3.p2.monthlyTitle')}>
                {tg('t3.p2.monthlyText')}
              </GuideOption>
              <GuideOption icon={Columns} title={tg('t3.p2.othersTitle')}>
                {tg('t3.p2.othersText')}
              </GuideOption>
              <GuideOption icon={Pencil} title={tg('t3.p2.scratchTitle')}>
                {tg('t3.p2.scratchText')}
              </GuideOption>
            </GuideOptionGrid>
          );
        },
        action: {
          get label() {
            return doNow();
          },
          get caption() {
            return tg('t3.p2.caption');
          },
          to: () => '/entregas?novo-fluxo=1',
        },
        signal: 'hasWorkflow',
      },
      {
        id: 't3p3',
        get title() {
          return tg('t3.p3.title');
        },
        videoSlug: 'criar-post',
        get lead() {
          return tg('t3.p3.lead');
        },
        get body() {
          return <GuideInfoBox>{tg('t3.p3.box')}</GuideInfoBox>;
        },
      },
      {
        id: 't3p4',
        get title() {
          return tg('t3.p4.title');
        },
        get lead() {
          return tg('t3.p4.lead');
        },
        get body() {
          return (
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
                <GuideStatusPill>{tg('t3.p4.draft')}</GuideStatusPill>
                <GuideStatusPill>{tg('t3.p4.review')}</GuideStatusPill>
                <GuideStatusPill>{tg('t3.p4.sent')}</GuideStatusPill>
                <GuideStatusPill tone="success">{tg('t3.p4.approved')}</GuideStatusPill>
                <GuideStatusPill tone="warning">{tg('t3.p4.scheduled')}</GuideStatusPill>
                <GuideStatusPill tone="success">{tg('t3.p4.posted')}</GuideStatusPill>
              </div>
              <GuideFine>{tg('t3.p4.fine')}</GuideFine>
            </>
          );
        },
      },
      {
        id: 't3p5',
        get title() {
          return tg('t3.p5.title');
        },
        videoSlug: 'agendar-post',
        get lead() {
          return tg('t3.p5.lead');
        },
        get body() {
          return (
            <>
              <GuideCheckList
                items={[
                  <>
                    {tg('t3.p5.statusPrefix')}{' '}
                    <GuideStatusPill tone="success">{tg('t3.p4.approved')}</GuideStatusPill>
                  </>,
                  tg('t3.p5.checkDate'),
                  tg('t3.p5.checkCaption'),
                  tg('t3.p5.checkMedia'),
                  tg('t3.p5.checkAccount'),
                ]}
              />
              <GuideInfoBox>
                <b>{tg('t3.p5.limitsLabel')}</b> · {tg('t3.p5.limitsText')}
              </GuideInfoBox>
            </>
          );
        },
      },
      {
        id: 't3p6',
        get title() {
          return tg('t3.p6.title');
        },
        get lead() {
          return tg('t3.p6.lead');
        },
        conclude: true,
      },
    ],
  },
];

export type GuideLimits = Partial<Record<'max_hub_tokens' | 'max_team_members', number | null>>;

function meetsMinLimit(page: GuidePage, limits: GuideLimits | null | undefined): boolean {
  if (!page.minLimit || !limits) return true; // limits loading or unlimited: keep the step
  const value = limits[page.minLimit.key];
  return value == null || value >= page.minLimit.min;
}

export function filterTrails(
  hasFeature: (flag: string) => boolean,
  limits?: GuideLimits | null,
): GuideTrail[] {
  // Object.create, not a spread: a spread would evaluate the text getters once and freeze them.
  return GUIDE_TRAILS.map(
    (t) =>
      Object.create(t, {
        pages: {
          enumerable: true,
          value: t.pages.filter(
            (p) =>
              (!p.entitlementFlag || hasFeature(p.entitlementFlag)) && meetsMinLimit(p, limits),
          ),
        },
      }) as GuideTrail,
  ).filter((t) => t.pages.length > 0);
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
