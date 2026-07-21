import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  completeEtapa: vi.fn(),
  completeEtapaWithRearm: vi.fn(),
}));
vi.mock('../../../store', () => store);

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { toast } from 'sonner';
import { completeEtapaForAdvance, notifyRearmOutcome } from '../advanceEtapa';

describe('completeEtapaForAdvance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.completeEtapa.mockResolvedValue({ workflow: { status: 'ativo' }, etapas: [] });
    store.completeEtapaWithRearm.mockResolvedValue({
      workflow: { status: 'ativo' },
      etapas: [],
      rearmed: true,
      rearmFailed: false,
    });
  });

  it('re-arms by default', async () => {
    const result = await completeEtapaForAdvance(1, 11);
    expect(store.completeEtapaWithRearm).toHaveBeenCalledWith(1, 11);
    expect(store.completeEtapa).not.toHaveBeenCalled();
    expect(result.rearmed).toBe(true);
  });

  it('re-arms when rearm is explicitly true', async () => {
    await completeEtapaForAdvance(1, 11, { rearm: true });
    expect(store.completeEtapaWithRearm).toHaveBeenCalledWith(1, 11);
  });

  it('uses plain completeEtapa when rearm is false, and reports no re-arm', async () => {
    const result = await completeEtapaForAdvance(1, 11, { rearm: false });
    expect(store.completeEtapa).toHaveBeenCalledWith(1, 11);
    expect(store.completeEtapaWithRearm).not.toHaveBeenCalled();
    expect(result).toMatchObject({ rearmed: false, rearmFailed: false });
  });

  it('passes the completion result through so callers keep their own recurring handling', async () => {
    store.completeEtapaWithRearm.mockResolvedValue({
      workflow: { status: 'concluido' },
      etapas: [{ id: 1 }],
      rearmed: false,
      rearmFailed: false,
    });
    const result = await completeEtapaForAdvance(1, 11);
    expect(result.workflow.status).toBe('concluido');
    expect(result.etapas).toEqual([{ id: 1 }]);
  });

  it('propagates a completion failure to the caller', async () => {
    store.completeEtapaWithRearm.mockRejectedValue(new Error('boom'));
    await expect(completeEtapaForAdvance(1, 11)).rejects.toThrow('boom');
  });

  it('emits no toasts itself — ordering is the caller’s to decide', async () => {
    await completeEtapaForAdvance(1, 11);
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('notifyRearmOutcome', () => {
  beforeEach(() => vi.clearAllMocks());

  it('announces a successful re-arm', () => {
    notifyRearmOutcome({ rearmed: true, rearmFailed: false });
    expect(toast.info).toHaveBeenCalledWith(
      'Posts voltaram para rascunho para o próximo ciclo de aprovação.',
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('asks for manual remediation when the re-arm failed after the advance', () => {
    notifyRearmOutcome({ rearmed: false, rearmFailed: true });
    expect(toast.error).toHaveBeenCalledWith(
      'A etapa avançou, mas não foi possível preparar os posts para o próximo ciclo de aprovação. Reinicie os status dos posts manualmente.',
    );
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('stays silent when nothing was re-armed', () => {
    notifyRearmOutcome({ rearmed: false, rearmFailed: false });
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
