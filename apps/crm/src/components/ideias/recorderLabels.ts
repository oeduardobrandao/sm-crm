import type { TFunction } from 'i18next';
import type { AudioRecorderLabels } from '@mesaas/ui/AudioRecorder';

/** Textos do AudioRecorder compartilhado no idioma atual (o padrão do pacote é pt). */
export function recorderLabels(t: TFunction): AudioRecorderLabels {
  return {
    record: t('ideaDrawer:shared.recorder.record'),
    uploading: t('ideaDrawer:shared.recorder.uploading'),
    transcribing: t('ideaDrawer:shared.recorder.transcribing'),
    micPermissionDenied: t('ideaDrawer:shared.recorder.micPermissionDenied'),
    micUnavailable: t('ideaDrawer:shared.recorder.micUnavailable'),
    stop: t('ideaDrawer:shared.recorder.stop'),
    stopAria: t('ideaDrawer:shared.recorder.stopAria'),
    progressAria: t('ideaDrawer:shared.recorder.progressAria'),
    remainingWarning: (remaining: string) =>
      t('ideaDrawer:shared.recorder.remainingWarning', { remaining }),
    previewLabel: t('ideaDrawer:shared.recorder.previewLabel'),
    sending: t('ideaDrawer:shared.recorder.sending'),
    discard: t('ideaDrawer:shared.recorder.discard'),
  };
}
