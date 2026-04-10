import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchBriefing, submitBriefingAnswer } from '../api';

export function BriefingPage() {
  const { token } = useHub();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-briefing', token],
    queryFn: () => fetchBriefing(token),
  });

  if (isLoading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );

  const questions = data?.questions ?? [];

  if (questions.length === 0) return (
    <div className="max-w-2xl mx-auto py-8 text-muted-foreground text-sm">
      Nenhuma pergunta disponível ainda.
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-6">Briefing</h2>
      <div className="space-y-6">
        {questions.map(q => (
          <QuestionItem
            key={q.id}
            question={q.question}
            initialAnswer={q.answer}
            onSave={async (answer) => {
              await submitBriefingAnswer(token, q.id, answer);
              qc.invalidateQueries({ queryKey: ['hub-briefing', token] });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function QuestionItem({
  question,
  initialAnswer,
  onSave,
}: {
  question: string;
  initialAnswer: string | null;
  onSave: (answer: string) => Promise<void>;
}) {
  const [answer, setAnswer] = useState(initialAnswer ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(answer);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border rounded-xl p-4 space-y-2">
      <p className="text-sm font-medium">{question}</p>
      <textarea
        className="w-full border rounded-lg p-2 text-sm resize-none min-h-[100px] focus:outline-none focus:ring-2 focus:ring-primary/30"
        value={answer}
        onChange={e => setAnswer(e.target.value)}
        placeholder="Digite sua resposta..."
      />
      <div className="flex justify-end">
        <button
          className="text-sm px-4 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          onClick={handleSave}
          disabled={saving}
        >
          {saved ? 'Salvo!' : saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}
