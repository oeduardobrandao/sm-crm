import { useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { NovaIdeiaDialog } from '@/components/ideias/NovaIdeiaDialog';
import type { CommentAnalysis } from '../../../services/instagramComments';

type Idea = CommentAnalysis['ideias'][number];

/** Prefilled description of an idea saved from a comments reading. */
export function suggestionDescription(idea: Idea, sourceLabel: string): string {
  return `${idea.descricao}\n\nOrigem: comentários de ${sourceLabel} (${idea.motivo})`;
}

/**
 * "Salvar como ideia" for one AI suggestion: opens the regular new-idea dialog prefilled
 * (client, title, description + origin, suggestion id) so the user reviews it and picks
 * "Visível no Hub" before saving. Once saved it turns into a disabled "Salva".
 */
export function SuggestionIdeaButton({
  clienteId,
  idea,
  sourceLabel,
  saved,
  onSaved,
  fullWidth = false,
}: {
  clienteId: number;
  idea: Idea;
  sourceLabel: string;
  saved: boolean;
  onSaved: () => void;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const className = `igc-btn igc-idea-btn${fullWidth ? ' igc-btn--block' : ''}`;

  if (saved) {
    return (
      <Button variant="outline" className={`${className} igc-idea-btn--saved`} disabled>
        <Check aria-hidden="true" size={14} strokeWidth={2.5} />
        Salva
      </Button>
    );
  }

  return (
    <>
      <Button className={className} onClick={() => setOpen(true)}>
        Salvar como ideia
      </Button>
      {open && (
        <NovaIdeiaDialog
          open
          onClose={() => setOpen(false)}
          onSaved={(id) => {
            setOpen(false);
            // '' = the suggestion was already saved (another tab, a double click).
            if (!id) toast.success('Esta sugestão já estava salva em Ideias.');
            onSaved();
          }}
          initialValues={{
            cliente_id: clienteId,
            titulo: idea.titulo,
            descricao: suggestionDescription(idea, sourceLabel),
            origem_sugestao_id: idea.id,
          }}
        />
      )}
    </>
  );
}
