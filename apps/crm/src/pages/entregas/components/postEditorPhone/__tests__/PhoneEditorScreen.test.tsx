import { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOverlayHistoryEntry } from '@/hooks/useOverlayHistoryEntry';
import { PhoneEditorScreen, type PhoneEditorScreenApi } from '../PhoneEditorScreen';

/**
 * The page owns the drawer's entry (EntregasPage), the drawer hosts the editor screen
 * (WorkflowDrawer). A `?post=` deep link opens both in the same commit, where the
 * child's effects run first: the screen's entry must still land ABOVE the drawer's.
 */
function Page({ deepLink, onAfterClose }: { deepLink: boolean; onAfterClose: () => void }) {
  const [drawer, setDrawer] = useState(deepLink);
  const [post, setPost] = useState(deepLink);
  const api = useRef<PhoneEditorScreenApi | null>(null);
  useOverlayHistoryEntry(drawer, () => {
    setDrawer(false);
    setPost(false);
  });
  return (
    <div>
      <span data-testid="drawer">{drawer ? 'open' : 'closed'}</span>
      <button
        onClick={() => {
          setDrawer(true);
          setPost(true);
        }}
      >
        deep link
      </button>
      {drawer && (
        <div>
          <button onClick={() => setPost(true)}>expand</button>
          <PhoneEditorScreen
            open={post}
            onClose={() => setPost(false)}
            label="Editor do post"
            apiRef={api}
          >
            <button onClick={() => setPost(false)}>Voltar</button>
            <button onClick={() => api.current?.closeThen(onAfterClose)}>Mover</button>
          </PhoneEditorScreen>
        </div>
      )}
    </div>
  );
}

function renderPage(deepLink = false, onAfterClose = vi.fn()) {
  window.history.replaceState(null, '', '/entregas');
  const router = createBrowserRouter([
    { path: '*', element: <Page deepLink={deepLink} onAfterClose={onAfterClose} /> },
  ]);
  render(<RouterProvider router={router} />);
  return { onAfterClose };
}

const idx = () => (window.history.state as { idx: number }).idx;
const editor = () => screen.queryByRole('region', { name: 'Editor do post' });

describe('PhoneEditorScreen history', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('deep link: first Back closes the editor, the second closes the drawer', async () => {
    renderPage();
    const start = idx();
    fireEvent.click(screen.getByText('deep link'));
    // Drawer entry, then the editor's one commit later.
    await waitFor(() => expect(idx()).toBe(start + 2));
    expect(editor()).not.toBeNull();

    act(() => window.history.back());
    await waitFor(() => expect(editor()).toBeNull());
    expect(screen.getByTestId('drawer').textContent).toBe('open');

    act(() => window.history.back());
    await waitFor(() => expect(screen.getByTestId('drawer').textContent).toBe('closed'));
    expect(idx()).toBe(start);
    expect(window.location.pathname).toBe('/entregas');
  });

  it('closing from the UI pops only the editor entry', async () => {
    renderPage();
    const start = idx();
    fireEvent.click(screen.getByText('deep link'));
    await waitFor(() => expect(idx()).toBe(start + 2));
    fireEvent.click(screen.getByText('Voltar'));
    await waitFor(() => expect(idx()).toBe(start + 1));
    expect(editor()).toBeNull();
    expect(screen.getByTestId('drawer').textContent).toBe('open');
  });

  it('closeThen runs the action after the editor entry is gone', async () => {
    const { onAfterClose } = renderPage();
    const start = idx();
    fireEvent.click(screen.getByText('deep link'));
    await waitFor(() => expect(idx()).toBe(start + 2));
    onAfterClose.mockImplementation(() => {
      // By now the history is back on the drawer's entry.
      expect(idx()).toBe(start + 1);
    });
    fireEvent.click(screen.getByText('Mover'));
    await waitFor(() => expect(onAfterClose).toHaveBeenCalledTimes(1));
    expect(editor()).toBeNull();
  });

  it('is a labelled region, never a dialog (open dialogs count as unsaved work)', async () => {
    renderPage();
    fireEvent.click(screen.getByText('deep link'));
    const region = await screen.findByRole('region', { name: 'Editor do post' });
    expect(region).not.toHaveAttribute('role', 'dialog');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
