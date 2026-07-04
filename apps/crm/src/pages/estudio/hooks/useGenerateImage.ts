// T6.4 — the generate-image mutation. Wraps the imageGen service, seeds the resolved-URL cache
// with the response's preview_url (so the inserted image renders with no round-trip flash), and
// refreshes the AI-image quota query so the panel's meter matches server truth after a spend.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  generateImage,
  type GenerateImageRequest,
  type GenerateImageResponse,
} from '../services/imageGen';
import { seedImageUrl } from './useImageUrls';
import { aiImageQuotaKey } from './useAiImageQuota';

export function useGenerateImage() {
  const qc = useQueryClient();
  return useMutation<GenerateImageResponse, Error, GenerateImageRequest>({
    mutationFn: generateImage,
    onSuccess: (res) => {
      // Prime BOTH the module seed (doc-wide render) and the single-file query (any useFileUrl
      // consumer) so the new image shows instantly.
      seedImageUrl(res.file_id, res.preview_url);
      qc.setQueryData(['estudio-file-url', res.file_id], res.preview_url);
      // The response's own quota is the freshest count — write it straight into the meter query.
      qc.setQueryData(aiImageQuotaKey(), res.quota);
    },
  });
}
