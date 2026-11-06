import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ hasPendingEditSuggestion: vi.fn() }));
vi.mock('../../../../store/posts', () => store);

import { useSuggestionMoveGuard } from '../useSuggestionMoveGuard';
import type { WorkflowPost } from '../../../../store/posts';

function Harness({
  target,
  current,
}: {
  target: WorkflowPost['status'];
  current?: WorkflowPost['status'];
}) {
  const { confirmMove, dialog } = useSuggestionMoveGuard();
  const [result, setResult] = useState<string>('idle');
  return (
    <>
      <button
        onClick={() => void confirmMove(7, target, current).then((ok) => setResult(String(ok)))}
      >
        mover
      </button>
      <output data-testid="result">{result}</output>
      {dialog}
    </>
  );
}

beforeEach(() => {
  store.hasPendingEditSuggestion.mockReset();
});

describe('useSuggestionMoveGuard', () => {
  it('libera sem diálogo e sem consulta quando o destino não é aprovado, agendado ou postado', async () => {
    render(<Harness target="revisao_interna" />);
    fireEvent.click(screen.getByText('mover'));
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('true'));
    expect(store.hasPendingEditSuggestion).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('libera sem diálogo quando o post não tem sugestão pendente', async () => {
    store.hasPendingEditSuggestion.mockResolvedValue(false);
    render(<Harness target="agendado" />);
    fireEvent.click(screen.getByText('mover'));
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('true'));
    expect(store.hasPendingEditSuggestion).toHaveBeenCalledWith(7);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('com sugestão pendente e destino agendado, pergunta e Cancelar resolve false', async () => {
    store.hasPendingEditSuggestion.mockResolvedValue(true);
    render(<Harness target="agendado" />);
    fireEvent.click(screen.getByText('mover'));
    expect(await screen.findByText('Mover para Agendado?')).toBeTruthy();
    expect(screen.getByText('Há uma sugestão do cliente não revisada neste post.')).toBeTruthy();
    expect(screen.getByTestId('result').textContent).toBe('idle');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('false'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('"Mover mesmo assim" resolve true', async () => {
    store.hasPendingEditSuggestion.mockResolvedValue(true);
    render(<Harness target="postado" />);
    fireEvent.click(screen.getByText('mover'));
    expect(await screen.findByText('Mover para Postado?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mover mesmo assim' }));
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('true'));
  });

  it('aprovado_cliente também pergunta, com o nome do status', async () => {
    store.hasPendingEditSuggestion.mockResolvedValue(true);
    render(<Harness target="aprovado_cliente" />);
    fireEvent.click(screen.getByText('mover'));
    expect(await screen.findByText('Mover para Aprovado pelo cliente?')).toBeTruthy();
  });

  it('libera sem consulta quando o status canônico não muda', async () => {
    render(<Harness target="aprovado_cliente" current="aprovado_cliente" />);
    fireEvent.click(screen.getByText('mover'));
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('true'));
    expect(store.hasPendingEditSuggestion).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('pergunta quando o status atual é outro que o destino', async () => {
    store.hasPendingEditSuggestion.mockResolvedValue(true);
    render(<Harness target="agendado" current="aprovado_cliente" />);
    fireEvent.click(screen.getByText('mover'));
    expect(await screen.findByText('Mover para Agendado?')).toBeTruthy();
  });

  it('se a consulta falha, não trava a equipe: libera e avisa no console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.hasPendingEditSuggestion.mockRejectedValue(new Error('offline'));
    render(<Harness target="agendado" />);
    fireEvent.click(screen.getByText('mover'));
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('true'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('pending suggestion lookup failed'),
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
