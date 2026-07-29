import type { SourceKind } from '@mesaas/import-parsers';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SOURCE_GUIDES, sourceGuide } from '../sourceGuides';

export default function StepOrigem({
  source,
  onSelect,
  onNext,
}: {
  source: SourceKind | null;
  onSelect: (source: SourceKind) => void;
  onNext: () => void;
}) {
  const guide = source ? sourceGuide(source) : null;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Traga seus clientes, calendário de conteúdo, entregas e ideias de outra ferramenta. Nada é
        publicado e nada é apagado: você confere tudo antes de importar e pode desfazer depois.
      </p>

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

      {guide && (
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <guide.icon aria-hidden="true" className="h-4 w-4 text-primary" />
              Como exportar do {guide.label}
            </h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button disabled={!source} onClick={onNext}>
          Continuar
        </Button>
      </div>
    </div>
  );
}
