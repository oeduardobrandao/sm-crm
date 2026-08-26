import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { captureEvent } from '../../lib/analytics';
import { useGuide } from './GuideContext';
import { requiredSignals, type GuidePage, type GuideTrail } from './guideContent';

const seg = (on: boolean): React.CSSProperties => ({
  flex: 1,
  height: 4,
  borderRadius: 2,
  background: on ? 'var(--primary-color)' : 'var(--border-color)',
});

export default function GuideDialog() {
  const g = useGuide();
  const navigate = useNavigate();

  const page =
    g?.currentPageId != null
      ? g.trails.flatMap((t) => t.pages).find((p) => p.id === g.currentPageId)
      : undefined;
  const trail = page ? g!.trails.find((t) => t.pages.some((p) => p.id === page.id)) : undefined;

  // Página vista: conclui páginas sem sinal e alimenta o contador.
  useEffect(() => {
    if (g && page) g.markSeen(page.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id]);

  if (!g) return null;

  const runAction = (p: GuidePage) => {
    if (!p.action) return;
    captureEvent('guide_action_clicked', { page: p.id });
    g.setLastPage(p.id);
    g.closeForAction();
    navigate(p.action.to({ latestClienteId: g.latestClienteId }));
  };

  const firstPageOf = (trailId: string) =>
    g.trails.find((t) => t.id === trailId)?.pages[0]?.id ?? null;

  return (
    <Dialog open={g.isOpen} onOpenChange={(open) => (!open ? g.close() : undefined)}>
      <DialogContent
        aria-describedby={undefined}
        style={{ maxWidth: 640, width: 'calc(100vw - 2rem)' }}
      >
        {page && trail ? (
          <PageView
            page={page}
            trail={trail}
            onBack={() => {
              const idx = trail.pages.findIndex((p) => p.id === page.id);
              g.goTo(idx > 0 ? trail.pages[idx - 1].id : null);
            }}
            onHome={() => g.goTo(null)}
            onNext={() => {
              const idx = trail.pages.findIndex((p) => p.id === page.id);
              if (page.bridgeTo) return g.goTo(firstPageOf(page.bridgeTo));
              if (page.conclude) return g.concludeGuide();
              g.goTo(idx < trail.pages.length - 1 ? trail.pages[idx + 1].id : null);
            }}
            onAction={() => runAction(page)}
            signalValues={g.signalValues}
            trails={g.trails}
          />
        ) : (
          <HomeView
            trails={g.trails}
            doneIds={g.doneIds}
            totals={g.totals}
            onStart={(t) => {
              const next = t.pages.find((p) => !g.doneIds.has(p.id)) ?? t.pages[0];
              g.goTo(next.id);
            }}
            onClose={() => g.close()}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function HomeView({
  trails,
  doneIds,
  totals,
  onStart,
  onClose,
}: {
  trails: GuideTrail[];
  doneIds: Set<string>;
  totals: { done: number; total: number };
  onStart(t: GuideTrail): void;
  onClose(): void;
}) {
  const pct = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;
  return (
    <div>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
        Guia de primeiros passos
      </p>
      <DialogTitle style={{ fontSize: '1.25rem', margin: '4px 0 0' }}>
        Bem-vindo ao Mesaas
      </DialogTitle>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>
        Três trilhas curtas, em páginas rápidas de ler. Feche quando quiser: o guia continua de onde
        parou.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 4px' }}>
        <div
          aria-hidden="true"
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            background: 'var(--border-color)',
            overflow: 'hidden',
          }}
        >
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary-color)' }} />
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {totals.done} de {totals.total} páginas
        </span>
      </div>
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {trails.map((t, i) => {
          const done = t.pages.filter((p) => doneIds.has(p.id)).length;
          const started = done > 0 && done < t.pages.length;
          const Icon = t.icon;
          return (
            <div
              key={t.id}
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: 12,
                padding: '13px 15px',
                display: 'flex',
                gap: 13,
                alignItems: 'center',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'var(--surface-2, #f5f6f8)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 'none',
                }}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '0.86rem', fontWeight: 600 }}>
                  <span aria-hidden="true">{i + 1}. </span>
                  {t.title}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {t.subtitle} · {done} de {t.pages.length} páginas
                </p>
              </div>
              <Button
                variant={started || (i === 0 && done === 0) ? 'default' : 'outline'}
                size="sm"
                onClick={() => onStart(t)}
              >
                {started ? 'Continuar' : done === t.pages.length ? 'Rever' : 'Começar'}
              </Button>
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 16,
          paddingTop: 12,
          borderTop: '1px solid var(--border-color)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            textDecoration: 'underline',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          Fechar por enquanto
        </button>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          Seu progresso fica salvo
        </span>
      </div>
    </div>
  );
}

function PageView({
  page,
  trail,
  onBack,
  onHome,
  onNext,
  onAction,
  signalValues,
  trails,
}: {
  page: GuidePage;
  trail: GuideTrail;
  onBack(): void;
  onHome(): void;
  onNext(): void;
  onAction(): void;
  signalValues: Partial<Record<string, boolean>>;
  trails: GuideTrail[];
}) {
  const idx = trail.pages.findIndex((p) => p.id === page.id);
  // Só recapitula sinais de páginas que de fato existem no plano do workspace: um t1p4
  // (Hub) removido por entitlement não deve deixar rastro no fechamento da trilha t1.
  const availableSignals = new Set(requiredSignals(trail ? trails : []));
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <button
          type="button"
          onClick={onHome}
          style={{
            background: 'none',
            border: 'none',
            display: 'inline-flex',
            gap: 7,
            alignItems: 'center',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {trail.title}
        </button>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          Página {idx + 1} de {trail.pages.length}
        </span>
      </div>
      <div aria-hidden="true" style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {trail.pages.map((p, i) => (
          <span key={p.id} style={seg(i <= idx)} />
        ))}
      </div>
      <DialogTitle style={{ fontSize: '1.05rem', margin: 0 }}>{page.title}</DialogTitle>
      <p
        style={{
          fontSize: '0.85rem',
          color: 'var(--text-main, inherit)',
          margin: '8px 0 0',
          lineHeight: 1.6,
        }}
      >
        {page.lead}
      </p>
      {page.body}
      {page.recap && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0 0', display: 'grid', gap: 9 }}>
          {page.recap
            .filter((r) => availableSignals.has(r.signal))
            .map((r) => {
              const ok = signalValues[r.signal] === true;
              return (
                <li
                  key={r.signal}
                  style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: '0.82rem' }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: ok ? 'rgba(62,207,142,0.18)' : 'var(--surface-2, #f1f5f9)',
                      color: ok ? 'var(--success)' : 'var(--text-muted)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flex: 'none',
                    }}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                  {r.label}
                </li>
              );
            })}
        </ul>
      )}
      {page.action && (
        <div
          style={{
            marginTop: 16,
            background: 'var(--surface-2, #f8fafc)',
            border: '1px solid var(--border-color)',
            borderRadius: 10,
            padding: '13px 15px',
            display: 'flex',
            gap: 13,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <p
            style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}
          >
            {page.action.caption}
          </p>
          <Button size="sm" onClick={onAction} style={{ flex: 'none' }}>
            {page.action.label}
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 18,
          paddingTop: 12,
          borderTop: '1px solid var(--border-color)',
        }}
      >
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar
        </Button>
        {page.conclude ? (
          <Button size="sm" onClick={onNext}>
            Concluir guia
            <Check className="h-3.5 w-3.5" />
          </Button>
        ) : page.bridgeTo ? (
          <Button size="sm" onClick={onNext}>
            {page.bridgeTo === 't2' ? 'Montar sua equipe' : 'Criar suas entregas'}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onNext}>
            Continuar
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
