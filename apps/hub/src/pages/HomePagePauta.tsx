import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { HubPost } from '../types';
import { DashboardSection } from '../components/dashboard/DashboardSection';
import { HomeAgendaPauta } from './agenda/HomeAgendaPauta';
import { PautaGreeting } from './home/PautaGreeting';
import { PautaKpiStrip } from './home/PautaKpiStrip';
import { ResourcesSection } from './home/ResourcesSection';
import { SectionHeader } from '../components/SectionHeader';
import { WaitingSection } from './home/WaitingSection';
import { numberSections, weekCount } from './home/pautaHome';
import { RESOURCE_LINKS } from './home/resourceLinks';
import { sortPostsChronologically } from '../lib/postView';
import { ListSkeleton } from '../components/Skeleton';

export function HomePagePauta({
  base,
  token,
  firstName,
  posts,
  loading,
  pendingCount,
  agendaEnabled,
  kpis,
  calendar,
  eventDialog,
}: {
  base: string;
  token: string;
  firstName: string;
  posts: HubPost[];
  loading: boolean;
  pendingCount: number;
  agendaEnabled: boolean;
  kpis: { thisMonth: string; pending: string; approvalRate: string; nextPost: string };
  calendar: ReactNode;
  eventDialog: ReactNode;
}) {
  const { t } = useTranslation('hubHome');
  const navigate = useNavigate();
  const goApprovals = () => navigate(`${base}/aprovacoes`);
  const sections = numberSections(pendingCount > 0, agendaEnabled);
  const pending = sortPostsChronologically(
    posts.filter((p) => p.status === 'enviado_cliente'),
  ).slice(0, 3);

  return (
    <div className="hub-fade-up flex flex-col gap-6">
      <PautaGreeting
        firstName={firstName}
        pendingCount={pendingCount}
        weekTotal={weekCount(posts, new Date())}
        loading={loading}
        onReview={goApprovals}
      />
      <PautaKpiStrip
        loading={loading}
        kpis={[
          { label: t('home.kpi.postsThisMonth.label', 'Posts este mês'), value: kpis.thisMonth },
          {
            label: t('home.pauta.kpi.pending', 'Para aprovar'),
            value: kpis.pending,
            emphasized: true,
            action:
              pendingCount > 0
                ? { label: t('home.pauta.kpi.reviewNow', 'Revisar agora'), onClick: goApprovals }
                : undefined,
          },
          {
            label: t('home.kpi.approvalRate.label', 'Taxa de aprovação'),
            value: kpis.approvalRate,
          },
          { label: t('home.kpi.nextPost.label', 'Próximo post'), value: kpis.nextPost },
        ]}
      />
      {loading ? (
        <section className="hub-card p-5 sm:p-6">
          <ListSkeleton rows={3} testId="pauta-home-loading" />
        </section>
      ) : (
        <>
          {sections.approvals !== null && (
            <WaitingSection number={sections.approvals} posts={pending} base={base} />
          )}
          <section className="hub-card p-5">
            <SectionHeader
              number={sections.calendar}
              label={t('home.pauta.section.calendar', 'Calendário')}
              title={t('home.calendarSection.subtitle', 'Próximas publicações')}
            />
            {calendar}
          </section>
          <div className={agendaEnabled ? 'grid gap-6 lg:grid-cols-[2fr_1fr]' : 'grid gap-6'}>
            {sections.agenda !== null && (
              <HomeAgendaPauta token={token} base={base} number={sections.agenda} />
            )}
            <ResourcesSection number={sections.resources} base={base} links={RESOURCE_LINKS} />
          </div>
          <DashboardSection sectionNumber={sections.results} />
        </>
      )}
      {eventDialog}
    </div>
  );
}
