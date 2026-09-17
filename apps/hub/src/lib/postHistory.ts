import type { CorrectionReason } from '../types';

/** The four fixed correction reasons required by hub-approve and the DB CHECK constraint. */
export const CORRECTION_REASONS: CorrectionReason[] = ['legenda', 'imagem_video', 'data', 'outro'];
