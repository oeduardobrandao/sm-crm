import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReferenceViewer } from '../ReferenceViewer';
import { makeReferenceItem } from '../../../../hooks/__tests__/postReferencesStub';

describe('ReferenceViewer', () => {
  it('shows an image', () => {
    render(<ReferenceViewer item={makeReferenceItem(1, { name: 'foto.jpg' })} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'foto.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'foto.jpg' })).toHaveAttribute(
      'src',
      'https://r2/get/1',
    );
  });

  it('plays a video inline with controls and falls back to the file on error', () => {
    const item = makeReferenceItem(2, {
      name: 'clip.mov',
      file_kind: 'video',
      mime_type: 'video/quicktime',
    });
    const { container } = render(<ReferenceViewer item={item} onClose={vi.fn()} />);
    const video = document.body.querySelector('video') as HTMLVideoElement;
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('preload', 'metadata');
    fireEvent.error(video);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível reproduzir aqui. Baixe o arquivo.',
    );
    expect(screen.getByRole('link', { name: 'Abrir o arquivo' })).toHaveAttribute(
      'href',
      'https://r2/get/2',
    );
    expect(container).toBeDefined();
  });

  it('closes from its button', () => {
    const onClose = vi.fn();
    render(<ReferenceViewer item={makeReferenceItem(1)} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar visualização' }));
    expect(onClose).toHaveBeenCalled();
  });
});
