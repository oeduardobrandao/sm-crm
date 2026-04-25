import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/fileService', () => ({
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
  renameFile: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { renameFolder, deleteFolder, renameFile, deleteFile } from '@/services/fileService';
import { toast } from 'sonner';
import { FileContextMenu } from '../components/FileContextMenu';
import type { Folder, FileRecord } from '../types';

const mockedRenameFolder = vi.mocked(renameFolder);
const mockedDeleteFolder = vi.mocked(deleteFolder);
const mockedRenameFile = vi.mocked(renameFile);
const mockedDeleteFile = vi.mocked(deleteFile);
const mockedToast = vi.mocked(toast);

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: 1,
    conta_id: 'conta-1',
    parent_id: null,
    name: 'Pasta Teste',
    source: 'user',
    source_type: null,
    source_id: null,
    name_overridden: false,
    position: 0,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function makeFile(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: 100,
    conta_id: 'conta-1',
    folder_id: 1,
    r2_key: 'files/foto.jpg',
    thumbnail_r2_key: null,
    name: 'foto.jpg',
    kind: 'image',
    mime_type: 'image/jpeg',
    size_bytes: 2048000,
    width: 1920,
    height: 1080,
    duration_seconds: null,
    blur_data_url: null,
    uploaded_by: null,
    reference_count: 0,
    created_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function rightClick(element: HTMLElement) {
  fireEvent.contextMenu(element);
}

describe('FileContextMenu', () => {
  const onActionComplete = vi.fn();

  beforeEach(() => {
    onActionComplete.mockReset();
    mockedRenameFolder.mockReset();
    mockedDeleteFolder.mockReset();
    mockedRenameFile.mockReset();
    mockedDeleteFile.mockReset();
  });

  it('right-click opens context menu with Renomear and Excluir', () => {
    render(
      <FileContextMenu item={makeFolder()} type="folder" onActionComplete={onActionComplete}>
        <div>Folder target</div>
      </FileContextMenu>,
    );

    rightClick(screen.getByText('Folder target'));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Renomear')).toBeInTheDocument();
    expect(screen.getByText('Excluir')).toBeInTheDocument();
  });

  it('shows Download option for files with url', () => {
    const file = makeFile({ url: 'https://cdn.example.com/file.jpg' });
    render(
      <FileContextMenu item={file} type="file" onActionComplete={onActionComplete}>
        <div>File target</div>
      </FileContextMenu>,
    );

    rightClick(screen.getByText('File target'));

    expect(screen.getByText('Download')).toBeInTheDocument();
  });

  it('does not show Download for folders', () => {
    render(
      <FileContextMenu item={makeFolder()} type="folder" onActionComplete={onActionComplete}>
        <div>Folder target</div>
      </FileContextMenu>,
    );

    rightClick(screen.getByText('Folder target'));

    expect(screen.queryByText('Download')).not.toBeInTheDocument();
  });

  it('system folders show "cannot delete" message instead of delete button', () => {
    const sysFolder = makeFolder({ source: 'system' });
    render(
      <FileContextMenu item={sysFolder} type="folder" onActionComplete={onActionComplete}>
        <div>System folder</div>
      </FileContextMenu>,
    );

    rightClick(screen.getByText('System folder'));

    expect(screen.getByText(/não pode ser excluída/)).toBeInTheDocument();
    // Rename should still be available
    expect(screen.getByText('Renomear')).toBeInTheDocument();
  });

  it('rename flow for folder: opens dialog, calls API, shows success toast', async () => {
    mockedRenameFolder.mockResolvedValue(makeFolder({ id: 1, name: 'Novo Nome' }));

    render(
      <FileContextMenu item={makeFolder({ id: 1, name: 'Original' })} type="folder" onActionComplete={onActionComplete}>
        <div>Rename target</div>
      </FileContextMenu>,
    );

    rightClick(screen.getByText('Rename target'));
    fireEvent.click(screen.getByText('Renomear'));

    // Rename dialog should be open
    const input = screen.getByDisplayValue('Original');
    expect(input).toBeInTheDocument();

    // Change name and submit
    fireEvent.change(input, { target: { value: 'Novo Nome' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => {
      expect(mockedRenameFolder).toHaveBeenCalledWith(1, 'Novo Nome');
    });
    expect(mockedToast.success).toHaveBeenCalledWith('Nome atualizado');
    expect(onActionComplete).toHaveBeenCalled();
  });

  it('rename flow for file calls renameFile', async () => {
    mockedRenameFile.mockResolvedValue(makeFile({ id: 100, name: 'renamed.jpg' }));

    const file = makeFile({ id: 100, name: 'foto.jpg' });
    render(
      <FileContextMenu item={file} type="file" onActionComplete={onActionComplete}>
        <div>File rename</div>
      </FileContextMenu>,
    );

    rightClick(screen.getByText('File rename'));
    fireEvent.click(screen.getByText('Renomear'));

    const input = screen.getByDisplayValue('foto.jpg');
    fireEvent.change(input, { target: { value: 'renamed.jpg' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => {
      expect(mockedRenameFile).toHaveBeenCalledWith(100, 'renamed.jpg');
    });
  });

  it('delete flow for folder: opens confirmation, calls API', async () => {
    mockedDeleteFolder.mockResolvedValue(undefined);

    render(
      <FileContextMenu item={makeFolder({ id: 3, name: 'Excluir Esta' })} type="folder" onActionComplete={onActionComplete}>
        <div>Delete folder</div>
      </FileContextMenu>,
    );

    rightClick(screen.getByText('Delete folder'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }));

    // Confirmation dialog
    await waitFor(() => {
      expect(screen.getByText(/será excluído permanentemente|serão excluídos permanentemente/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));

    await waitFor(() => {
      expect(mockedDeleteFolder).toHaveBeenCalledWith(3);
    });
    expect(mockedToast.success).toHaveBeenCalledWith('Pasta excluída');
    expect(onActionComplete).toHaveBeenCalled();
  });

  it('delete flow for file: opens confirmation, calls deleteFile', async () => {
    mockedDeleteFile.mockResolvedValue(undefined);

    const file = makeFile({ id: 50, name: 'apagar.jpg' });
    render(
      <FileContextMenu item={file} type="file" onActionComplete={onActionComplete}>
        <div>Delete file</div>
      </FileContextMenu>,
    );

    rightClick(screen.getByText('Delete file'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }));

    await waitFor(() => {
      expect(screen.getByText(/será excluído permanentemente/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));

    await waitFor(() => {
      expect(mockedDeleteFile).toHaveBeenCalledWith(50);
    });
    expect(mockedToast.success).toHaveBeenCalledWith('Arquivo excluído');
  });

  it('blocks delete for files linked to posts and shows error toast', () => {
    const file = makeFile({ id: 100, reference_count: 2 });
    render(
      <FileContextMenu item={file} type="file" onActionComplete={onActionComplete}>
        <div>Linked file</div>
      </FileContextMenu>,
    );

    rightClick(screen.getByText('Linked file'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }));

    // Should show toast error, not open confirmation
    expect(mockedToast.error).toHaveBeenCalledWith(
      expect.stringContaining('2 post(s)'),
    );
  });

  it('closes menu on Escape key', () => {
    render(
      <FileContextMenu item={makeFolder()} type="folder" onActionComplete={onActionComplete}>
        <div>Escape target</div>
      </FileContextMenu>,
    );

    rightClick(screen.getByText('Escape target'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
