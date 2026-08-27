import { Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import type { SourceGuide } from '../sourceGuides';

const KB_SLUG = 'como-exportar-seus-dados-do-notion-trello-e-clickup';

function GuideContent({ guide }: { guide: SourceGuide }) {
  return (
    <>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {guide.notes && guide.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {guide.notes.map((note) => (
            <li key={note} className="flex gap-2 text-muted-foreground">
              <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs">
        <Link to={`/ajuda/${KB_SLUG}`} className="text-primary hover:underline">
          Ver o guia completo na Central de Ajuda
        </Link>
      </p>
    </>
  );
}

export default function SourceGuideCard({
  guide,
  collapsible,
}: {
  guide: SourceGuide;
  collapsible?: boolean;
}) {
  const Icon = guide.icon;
  const heading = `Como exportar do ${guide.label}`;

  if (collapsible) {
    return (
      <Card>
        <CardContent className="pt-6">
          <details open>
            <summary className="mb-3 flex cursor-pointer items-center gap-2 text-base font-semibold">
              <Icon aria-hidden className="h-4 w-4 text-primary" />
              {heading}
            </summary>
            <GuideContent guide={guide} />
          </details>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Icon aria-hidden className="h-4 w-4 text-primary" />
          {heading}
        </h2>
        <GuideContent guide={guide} />
      </CardContent>
    </Card>
  );
}
