import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { SourceKind } from '@mesaas/import-parsers';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SOURCE_GUIDES, sourceGuide } from '../sourceGuides';
import SourceGuideCard from './SourceGuideCard';

export default function StepOrigem({
  source,
  onSelect,
  onNext,
}: {
  source: SourceKind | null;
  onSelect: (source: SourceKind) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation('importWizard');
  const guide = source ? sourceGuide(source) : null;
  return (
    <div className="space-y-6">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-6">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <Bot aria-hidden className="h-5 w-5 text-primary" />
            {t('origem.mcpTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('origem.mcpBody')}</p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link to="/configuracao/mcp" className="font-medium text-primary hover:underline">
              {t('origem.connectAgent')}
            </Link>
            <Link
              to="/ajuda/como-conectar-o-claude-mcp"
              className="font-medium text-primary hover:underline"
            >
              {t('origem.howItWorks')}
            </Link>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">{t('origem.choose')}</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SOURCE_GUIDES.map((s) => {
          const Icon = s.icon;
          const selected = source === s.id;
          return (
            <button
              key={s.id}
              type="button"
              aria-label={s.label}
              aria-pressed={selected}
              onClick={() => onSelect(s.id)}
              // focus-visible mirrors ui/button.tsx so a keyboard user gets the
              // same ring here as on every other control in the app; these are
              // hand-rolled <button>s, so they inherit none of it automatically.
              className={`rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                selected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40 hover:bg-accent'
              }`}
            >
              {/* aria-hidden: the icon repeats the label beside it, so exposing
                  it to a screen reader would just read the source name twice. */}
              <Icon
                aria-hidden="true"
                className={`mb-2 h-5 w-5 ${selected ? 'text-primary' : 'text-muted-foreground'}`}
              />
              <span className="block font-semibold">{s.label}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{s.hint}</span>
            </button>
          );
        })}
      </div>

      {guide && <SourceGuideCard guide={guide} />}

      <div className="flex justify-end">
        <Button disabled={!source} onClick={onNext}>
          {t('nav.next')}
        </Button>
      </div>
    </div>
  );
}
