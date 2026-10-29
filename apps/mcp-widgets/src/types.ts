// structuredContent shapes the mcp edge function sends (plan Tasks 3, 4, 6, 7).
// Every card carries `card` and `v: 1`; anything else renders the fallback.

export type Tipo = 'feed' | 'carrossel' | 'reels' | 'stories';

export interface ClientRef {
  id: number;
  nome: string;
}

export interface PreviewData {
  card: 'post_preview';
  v: 1;
  client: ClientRef;
  titulo: string;
  tipo: Tipo;
  pilar?: string;
  slides?: { texto: string }[];
  roteiro?: string;
  ig_caption: string;
  caption_len: number;
  caption_max: number;
  post_id?: number;
  body: string;
}

export interface CaptionOptionsData {
  card: 'caption_options';
  v: 1;
  client: ClientRef;
  post_id?: number;
  options: { label: string; text: string; len: number }[];
  caption_max: number;
}

export interface CalendarPost {
  id: number;
  titulo: string;
  tipo: Tipo;
  status: string;
}

export interface CalendarData {
  card: 'client_calendar';
  v: 1;
  client: ClientRef;
  from: string;
  weeks: number;
  days: { date: string; posts: CalendarPost[]; gap: boolean }[];
  usual_weekdays: number[];
  open_url: string;
}

export interface AttachImageData {
  card: 'attach_image';
  v: 1;
  post: { id: number; titulo: string; tipo: Tipo; status: string };
  client: ClientRef;
  media: { position: number; url: string }[];
  max: number;
  eligible: boolean;
  reason?: string;
  image: { download_url: string; file_id: string };
  position?: number;
}

export type SendOutcome = 'sent' | 'already_sent' | 'approved' | 'failed' | 'stale';

export interface SendResultData {
  card: 'send_result';
  v: 1;
  post_id: number;
  outcome: SendOutcome;
}

export type CardData =
  | PreviewData
  | CaptionOptionsData
  | CalendarData
  | AttachImageData
  | SendResultData;

export const SEND_NONCE_META_KEY = 'mesaas/sendNonce';
