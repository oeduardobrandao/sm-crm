import { useState, useRef, useCallback } from 'react';
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

  const [briefingTab, setBriefingTab] = useState(0);
  const [sectionTab, setSectionTab] = useState(0);

  if (isLoading)
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
      </div>
    );

  const briefings = data?.briefings ?? [];

  if (briefings.length === 0)
    return <div className="py-8 text-stone-500 text-sm">Nenhum briefing disponível ainda.</div>;

  const hasBriefingTabs = briefings.length > 1;
  const activeBriefing = briefings[Math.min(briefingTab, briefings.length - 1)];
  const questions = activeBriefing?.questions ?? [];

  // Group the active briefing's questions by section.
  const sections: { name: string; questions: BriefingQuestion[] }[] = [];
  for (const q of questions) {
    const name = q.section ?? 'Geral';
    const existing = sections.find((s) => s.name === name);
    if (existing) existing.questions.push(q);
    else sections.push({ name, questions: [q] });
  }

  const hasSectionTabs = sections.length > 1;
  const visibleQuestions = hasSectionTabs
    ? (sections[Math.min(sectionTab, sections.length - 1)]?.questions ?? [])
    : questions;

  function handleSave(questionId: string) {
    return async (answer: string) => {
      await submitBriefingAnswer(token, questionId, answer);
      qc.invalidateQueries({ queryKey: ['hub-briefing', token] });
    };
  }

  return (
    <div className="max-w-3xl mx-auto hub-fade-up">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-2">
          <span className="accent-bar" />
          Seu projeto
        </p>
        <h2 className="font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] font-medium tracking-tight text-stone-900">
          Briefing
        </h2>
      </header>

      {hasBriefingTabs && (
        <div className="relative mb-6 border-b border-stone-200/80">
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {briefings.map((b, i) => (
              <button
                key={b.id}
                onClick={() => {
                  setBriefingTab(i);
                  setSectionTab(0);
                }}
                className={`relative px-4 py-3 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                  briefingTab === i ? 'text-stone-900' : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                {b.title}
                {briefingTab === i && (
                  <span className="absolute left-3 right-3 -bottom-[1px] h-[2px] rounded-full bg-[#FFBF30]" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasSectionTabs && (
        <div className="relative mb-8 border-b border-stone-200/80">
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {sections.map((s, i) => (
              <button
                key={s.name}
                onClick={() => setSectionTab(i)}
                className={`relative px-4 py-3 text-[13px] font-medium whitespace-nowrap transition-colors ${
                  sectionTab === i ? 'text-stone-900' : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                {s.name}
                {sectionTab === i && (
                  <span className="absolute left-3 right-3 -bottom-[1px] h-[2px] rounded-full bg-stone-400" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {visibleQuestions.length === 0 ? (
        <div className="py-8 text-stone-500 text-sm">Nenhuma pergunta neste briefing ainda.</div>
      ) : (
        <div className="space-y-4">
          {visibleQuestions.map((q) => (
            <QuestionItem
              key={q.id}
              question={q.question}
              initialAnswer={q.answer}
              onSave={handleSave(q.id)}
            />
          ))}
        </div>
      )}
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
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (value: string) => {
      setAnswer(value);
      setStatus('saving');
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          await onSave(value);
          setStatus('saved');
          setTimeout(() => setStatus('idle'), 2000);
        } catch {
          setStatus('idle');
        }
      }, 800);
    },
    [onSave],
  );

  return (
    <div className="hub-card p-5 sm:p-6 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] font-semibold text-stone-900 leading-snug">{question}</p>
        <span className="shrink-0 text-[11px] font-medium min-w-[56px] text-right">
          {status === 'saving' && <span className="text-stone-400">Salvando…</span>}
          {status === 'saved' && <span className="text-emerald-600">✓ Salvo</span>}
        </span>
      </div>
      <textarea
        className="w-full border border-stone-200/80 rounded-lg px-3.5 py-3 text-[14px] resize-none min-h-[112px] bg-stone-50/40 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-[#FFBF30]/15 transition-all"
        value={answer}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Digite sua resposta…"
      />
    </div>
  );
}
