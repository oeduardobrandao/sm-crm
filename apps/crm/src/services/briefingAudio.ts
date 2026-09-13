import { supabase } from '../lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export interface CrmBriefingAudio {
  url: string;
  mime: string;
  duration_seconds: number | null;
  transcription_status: 'pending' | 'done' | 'failed' | null;
  recorded_at: string | null;
}

export async function fetchBriefingAudio(questionId: string): Promise<CrmBriefingAudio> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');
  const url = new URL(`${SUPABASE_URL}/functions/v1/briefing-audio`);
  url.searchParams.set('question_id', questionId);
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<CrmBriefingAudio>;
}
