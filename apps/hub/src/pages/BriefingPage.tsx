import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import {
  deleteBriefingAudio,
  fetchBriefing,
  retryBriefingTranscription,
  submitBriefingAnswer,
} from '../api';
import { describeAudioError, uploadBriefingAudio } from '../services/briefingAudio';
import { AudioPlayer } from '@mesaas/ui/AudioPlayer';
import {
  AudioRecorder,
  HUB_AUDIO_VARS,
  isRecordingSupported,
  type RecorderPhase,
} from '../components/AudioRecorder';
import { PageHeader } from '../components/PageHeader';
import { ScrollableTabs } from '../components/ScrollableTabs';
import type { BriefingAudio, BriefingAudioResponse, BriefingQuestion } from '../types';

export function BriefingPage() {
  const { token, bootstrap } = useHub();
  // Gate de plano (Pro/Max). Ausente num bootstrap antigo = desligado; o
  // hub-briefing recusa a escrita de qualquer forma, isto só evita oferecer
  // um botão que responderia 403.
  const audioEnabled = bootstrap.feature_briefing_audio === true;
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
                  token={token}
                  question={q}
                  onSave={handleSave(q.id)}
                  audioEnabled={audioEnabled}
                  onAudioChanged={() => qc.invalidateQueries({ queryKey: ['hub-briefing', token] })}
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
  token,
  question,
  onSave,
  audioEnabled,
  onAudioChanged,
}: {
  token: string;
  question: BriefingQuestion;
  onSave: (answer: string) => Promise<void>;
  audioEnabled: boolean;
  onAudioChanged: () => void;
}) {
  const [answer, setAnswer] = useState(question.answer ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [audio, setAudio] = useState<BriefingAudio | null>(question.audio);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'retry' | 'remove' | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the most recently typed value and whether a debounced save for it
  // hasn't landed yet. An audio action (record, retry) that starts while this
  // is dirty must flush it first — the server computes the "done" transcript
  // append from the DB row's current `answer`, so a cancelled debounce would
  // let the server overwrite the user's unsaved edit with a stale value.
  const pendingRef = useRef<{ value: string; dirty: boolean }>({ value: answer, dirty: false });
  const locked = phase !== 'idle' || busyAction !== null;

  // The server is the source of truth for audio: a background refetch (e.g.
  // triggered by onAudioChanged after another tab removed it, or after this
  // question's upload failed) must replace the local audio state.
  //
  // It's also the source of truth for the answer text once it diverges from
  // what's shown locally — this covers an upload that failed on the client
  // (network drop) but actually finished server-side, appending the
  // transcript to `answer` before the response was lost; the refetch that
  // follows (onAudioChanged) brings back a fresher `question.answer` than
  // local state. We only take it over when nothing local is in flight or
  // unsaved: never while the user is actively typing (a dirty pending save)
  // or while a save/audio action is being flushed to the server.
  useEffect(() => {
    setAudio(question.audio);
    if (
      question.answer != null &&
      question.answer !== answer &&
      !pendingRef.current.dirty &&
      status !== 'saving' &&
      phase === 'idle' &&
      busyAction === null
    ) {
      setAnswer(question.answer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.audio, question.answer]);

  const handleChange = useCallback(
    (value: string) => {
      setAnswer(value);
      setStatus('saving');
      pendingRef.current = { value, dirty: true };
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          await onSave(value);
          pendingRef.current = { value, dirty: false };
          setStatus('saved');
          setTimeout(() => setStatus('idle'), 2000);
        } catch {
          setStatus('error');
        }
      }, 800);
    },
    [onSave],
  );

  // Flushes a pending debounced save synchronously instead of letting
  // handleRecorded/handleRetry cancel it outright. Throws (after surfacing
  // the failure via `status`) when the save itself fails, so callers can
  // abort the audio action rather than proceed against a stale answer.
  async function flushPendingSave(): Promise<void> {
    if (!pendingRef.current.dirty) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const value = pendingRef.current.value;
    try {
      await onSave(value);
      pendingRef.current = { value, dirty: false };
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
      throw new Error('flush-pending-save-failed');
    }
  }

  function applyResponse(res: BriefingAudioResponse) {
    if (res.answer !== null) setAnswer(res.answer);
    setAudio(res.audio);
    onAudioChanged();
  }

  async function handleRecorded(blob: Blob, mime: string, durationSeconds: number) {
    // Locks the textarea and the recorder for the whole operation, including
    // the flush below — otherwise a second click on "Enviar" during that
    // network round-trip (busy was only set after the flush resolved) could
    // fire a second presign/upload/finalize before this one lands.
    setPhase('uploading');
    try {
      await flushPendingSave();
    } catch {
      setAudioError('Não foi possível salvar o texto. Tente de novo.');
      setPhase('idle');
      throw new Error('Não foi possível salvar o texto. Tente de novo.');
    }
    setAudioError(null);
    try {
      const res = await uploadBriefingAudio({
        token,
        questionId: question.id,
        blob,
        mime,
        durationSeconds,
        onPhase: setPhase,
      });
      applyResponse(res);
    } catch (e) {
      setAudioError(describeAudioError(e, 'Não foi possível enviar o áudio.'));
      // O servidor pode ter gravado o áudio antes da falha de rede (ex: o
      // upload/finalize terminou no servidor, mas a resposta não chegou) —
      // refaz o fetch em vez de confiar só no estado local.
      onAudioChanged();
      throw e;
    } finally {
      setPhase('idle');
    }
  }

  async function handleRetry() {
    // Locks the recorder/answer for the whole operation, including the flush
    // below — otherwise a second click on "Tentar novamente" during that
    // network round-trip (busyAction was only set after the flush resolved)
    // could fire a second transcription request before this one lands.
    setBusyAction('retry');
    try {
      await flushPendingSave();
    } catch {
      setAudioError('Não foi possível salvar o texto. Tente de novo.');
      setBusyAction(null);
      return;
    }
    setAudioError(null);
    try {
      applyResponse(await retryBriefingTranscription(token, question.id));
    } catch (e) {
      setAudioError(describeAudioError(e, 'Não foi possível transcrever.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRemove() {
    setBusyAction('remove');
    setAudioError(null);
    try {
      await deleteBriefingAudio(token, question.id);
      setAudio(null);
      onAudioChanged();
    } catch (e) {
      setAudioError(describeAudioError(e, 'Não foi possível remover o áudio.'));
    } finally {
      setBusyAction(null);
    }
  }

  const transcriptionLabel =
    audio?.transcription_status === 'done'
      ? 'Transcrição adicionada à resposta.'
      : audio?.transcription_status === 'pending'
        ? 'Transcrição pendente.'
        : audio
          ? 'Não foi possível transcrever este áudio.'
          : null;

  return (
    <div className="hub-card p-5 sm:p-6 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] font-semibold hub-txt leading-snug">{question.question}</p>
        <span className="shrink-0 text-[11px] font-medium min-w-[56px] text-right">
          {status === 'saving' && <span className="hub-tx3">Salvando…</span>}
          {status === 'saved' && <span className="text-emerald-600">✓ Salvo</span>}
          {status === 'error' && (
            <span className="text-red-500">Não foi possível salvar. Tente de novo.</span>
          )}
        </span>
      </div>
      <textarea
        className="hub-focus-accent w-full border hub-border rounded-lg px-3.5 py-3 text-[14px] resize-none min-h-[112px] bg-[color-mix(in_srgb,var(--hub-soft)_40%,transparent)] hub-txt placeholder:text-[var(--hub-tx3)] focus:outline-none focus:bg-[var(--hub-card)] focus:border-[var(--hub-bd2)] focus:ring-4 transition-all disabled:opacity-60"
        value={answer}
        disabled={locked}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Digite sua resposta ou grave um áudio…"
      />

      {audio && (
        <div className="space-y-2 rounded-lg border hub-border p-3">
          <AudioPlayer
            src={audio.url}
            durationSeconds={audio.duration_seconds}
            label="Resposta em áudio"
            className="hub-txt w-full max-w-[420px]"
            style={HUB_AUDIO_VARS}
          />
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className={audio.transcription_status === 'failed' ? 'text-red-500' : 'hub-tx3'}>
              {transcriptionLabel}
            </span>
            {audioEnabled && audio.transcription_status !== 'done' && (
              <button
                type="button"
                className="font-semibold underline hub-txt disabled:opacity-50"
                disabled={busyAction !== null || locked}
                onClick={() => void handleRetry()}
              >
                {busyAction === 'retry' ? 'Transcrevendo…' : 'Tentar novamente'}
              </button>
            )}
            <button
              type="button"
              className="font-semibold underline hub-tx3 disabled:opacity-50"
              disabled={busyAction !== null || locked}
              onClick={() => void handleRemove()}
            >
              {busyAction === 'remove' ? 'Removendo…' : 'Remover áudio'}
            </button>
          </div>
        </div>
      )}

      {audioEnabled && isRecordingSupported() && (
        <AudioRecorder phase={phase} disabled={busyAction !== null} onRecorded={handleRecorded} />
      )}
      {audioError && <p className="text-xs text-red-500">{audioError}</p>}
    </div>
  );
}
