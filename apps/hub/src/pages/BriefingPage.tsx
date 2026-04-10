import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchBriefing, submitBriefingAnswer } from '../api';
import type { BriefingQuestion } from '../types';

export function BriefingPage() {
  const { token } = useHub();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-briefing', token],
    queryFn: () => fetchBriefing(token),
  });

  const [activeTab, setActiveTab] = useState(0);

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

  // Group by section. Questions with null section go into a default group.
  const sections: { name: string; questions: BriefingQuestion[] }[] = [];
  for (const q of questions) {
    const name = q.section ?? 'Geral';
    const existing = sections.find(s => s.name === name);
    if (existing) {
      existing.questions.push(q);
    } else {
      sections.push({ name, questions: [q] });
    }
  }

  const hasTabs = sections.length > 1;
  const visibleQuestions = hasTabs ? sections[activeTab]?.questions ?? [] : questions;

  function handleSave(questionId: string) {
    return async (answer: string) => {
      await submitBriefingAnswer(token, questionId, answer);
      qc.invalidateQueries({ queryKey: ['hub-briefing', token] });
    };
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-6">Briefing</h2>

      {hasTabs && (
        <div className="flex gap-1 border-b mb-6">
          {sections.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === i
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-6">
        {visibleQuestions.map(q => (
          <QuestionItem
            key={q.id}
            question={q.question}
            initialAnswer={q.answer}
            onSave={handleSave(q.id)}
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
    <div className="border rounded-sm p-4 space-y-2">
      <p className="text-sm font-medium">{question}</p>
      <textarea
        className="w-full border rounded-sm p-2 text-sm resize-none min-h-[100px] focus:outline-none focus:ring-2 focus:ring-primary/30"
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
