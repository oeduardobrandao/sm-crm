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
      <p className="text-sm text-muted">
        Traga seus clientes, calendário de conteúdo, entregas e ideias de outra ferramenta. Nada é
        publicado e nada é apagado: você confere tudo antes de importar e pode desfazer depois.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SOURCE_GUIDES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-label={s.label}
            aria-pressed={source === s.id}
            onClick={() => onSelect(s.id)}
            className={`rounded-xl border p-4 text-left transition ${
              source === s.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/10'
            }`}
          >
            <span className="block font-semibold">{s.label}</span>
            <span className="mt-1 block text-xs text-muted">{s.hint}</span>
          </button>
        ))}
      </div>

      {guide && (
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-3 text-base font-semibold">Como exportar do {guide.label}</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
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
