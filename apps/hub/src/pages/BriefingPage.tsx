import { useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchBriefing, submitBriefingAnswer } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ScrollableTabs } from '../components/ScrollableTabs';
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

  const briefings = data?.briefings ?? [];
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
    <div className="max-w-5xl mx-auto hub-fade-up">
      <PageHeader
        title="Briefing"
        description="As informações que orientam a estratégia do seu projeto."
      />
      {activeBriefing?.title && (
        <p className="-mt-6 mb-8 text-[15px] font-medium hub-tx3">{activeBriefing.title}</p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      ) : briefings.length === 0 ? (
        <div className="py-8 hub-tx3 text-sm">Nenhum briefing disponível ainda.</div>
      ) : (
        <>
          {hasBriefingTabs && (
            <ScrollableTabs label="Briefings" activeKey={briefingTab} className="mb-6">
              {briefings.map((b, i) => (
                <button
                  key={b.id}
                  role="tab"
                  aria-selected={briefingTab === i}
                  data-active={briefingTab === i}
                  onClick={() => {
                    setBriefingTab(i);
                    setSectionTab(0);
                  }}
                  className={`relative px-4 py-3 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                    briefingTab === i ? 'hub-txt' : 'hub-tab-btn hub-tx3'
                  }`}
                >
                  {b.title || 'Briefing'}
                  {briefingTab === i && (
                    <span className="absolute left-3 right-3 -bottom-[1px] h-[2px] rounded-full bg-[var(--hub-txt)]" />
                  )}
                </button>
              ))}
            </ScrollableTabs>
          )}

          {hasSectionTabs && (
            <ScrollableTabs label="Seções do briefing" activeKey={sectionTab} className="mb-8">
              {sections.map((s, i) => (
                <button
                  key={s.name}
                  role="tab"
                  aria-selected={sectionTab === i}
                  data-active={sectionTab === i}
                  onClick={() => setSectionTab(i)}
                  className={`relative px-4 py-3 text-[13px] font-medium whitespace-nowrap transition-colors ${
                    sectionTab === i ? 'hub-txt' : 'hub-tab-btn hub-tx3'
                  }`}
                >
                  {s.name}
                  {sectionTab === i && (
                    <span className="absolute left-3 right-3 -bottom-[1px] h-[2px] rounded-full bg-[var(--hub-bd2)]" />
                  )}
                </button>
              ))}
            </ScrollableTabs>
          )}

          {visibleQuestions.length === 0 ? (
            <div className="py-8 hub-tx3 text-sm">Nenhuma pergunta neste briefing ainda.</div>
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
        </>
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
        <p className="text-[14px] font-semibold hub-txt leading-snug">{question}</p>
        <span className="shrink-0 text-[11px] font-medium min-w-[56px] text-right">
          {status === 'saving' && <span className="hub-tx3">Salvando…</span>}
          {status === 'saved' && <span className="text-emerald-600">✓ Salvo</span>}
        </span>
      </div>
      <textarea
        className="hub-focus-accent w-full border hub-border rounded-lg px-3.5 py-3 text-[14px] resize-none min-h-[112px] bg-[color-mix(in_srgb,var(--hub-soft)_40%,transparent)] hub-txt placeholder:text-[var(--hub-tx3)] focus:outline-none focus:bg-[var(--hub-card)] focus:border-[var(--hub-bd2)] focus:ring-4 transition-all"
        value={answer}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Digite sua resposta…"
      />
    </div>
  );
}
