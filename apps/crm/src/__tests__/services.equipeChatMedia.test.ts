import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFetchMock } from '../../../../test/shared/fetchMock';

vi.mock('@/lib/supabase');

import {
  EQUIPE_CHAT_ANEXO_MIME,
  MAX_EQUIPE_CHAT_ANEXO_BYTES,
  signEquipeChatAnexoView,
  uploadEquipeChatAnexo,
  validateEquipeChatFile,
} from '@/services/equipeChatMedia';

class MockXHR {
  static instances: MockXHR[] = [];

  status = 200;
  method = '';
  url = '';
  body: File | null = null;
  headers = new Map<string, string>();
  upload = {
    onprogress: null as
      | ((event: { lengthComputable: boolean; loaded: number; total: number }) => void)
      | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    MockXHR.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  send(body: File) {
    this.body = body;
    this.upload.onprogress?.({ lengthComputable: true, loaded: body.size, total: body.size });
    queueMicrotask(() => this.onload?.());
  }
}

const fetchHarness = createFetchMock();

function createFile(name: string, type: string, size = 128) {
  return new File([new Uint8Array(size)], name, { type });
}

describe('services/equipeChatMedia', () => {
  beforeEach(() => {
    fetchHarness.reset();
    MockXHR.instances.length = 0;
    vi.stubGlobal('fetch', fetchHarness.fetchMock);
    vi.stubGlobal('XMLHttpRequest', MockXHR);
  });

  describe('validateEquipeChatFile', () => {
    it('rejeita mime fora da allowlist', () => {
      const file = createFile('planilha.xlsx', 'application/vnd.ms-excel', 1024);
      expect(validateEquipeChatFile(file)).toBe(
        'Tipo de arquivo não suportado. Use imagem, PDF ou ZIP.',
      );
    });

    it('aceita todos os mimes da allowlist declarada', () => {
      for (const mime of EQUIPE_CHAT_ANEXO_MIME) {
        expect(validateEquipeChatFile(createFile('arquivo', mime, 1024))).toBeNull();
      }
    });

    it('rejeita arquivo maior que 25MB', () => {
      const file = createFile('grande.png', 'image/png', MAX_EQUIPE_CHAT_ANEXO_BYTES + 1);
      expect(validateEquipeChatFile(file)).toBe('O arquivo precisa ter no máximo 25MB.');
    });

    it('aceita um PNG de 1KB', () => {
      const file = createFile('foto.png', 'image/png', 1024);
      expect(validateEquipeChatFile(file)).toBeNull();
    });
  });

  describe('uploadEquipeChatAnexo', () => {
    it('faz presign, PUT e finalize, devolvendo o anexo do finalize', async () => {
      const file = createFile('contrato.pdf', 'application/pdf', 2048);
      const onProgress = vi.fn();

      fetchHarness.queueResponse({
        json: { upload_url: 'https://upload.r2.dev/equipe-chat-1', key: 'equipe-chat/tmp/1.pdf' },
      });
      fetchHarness.queueResponse({
        json: {
          anexo: {
            id: 9,
            file_name: 'contrato.pdf',
            mime_type: 'application/pdf',
            size_bytes: 2048,
          },
        },
      });

      const anexo = await uploadEquipeChatAnexo(7, file, onProgress);

      expect(anexo).toEqual({
        id: 9,
        file_name: 'contrato.pdf',
        mime_type: 'application/pdf',
        size_bytes: 2048,
      });

      expect(fetchHarness.calls).toHaveLength(2);
      expect(String(fetchHarness.calls[0].input)).toContain('equipe-chat-media/presign');
      expect(fetchHarness.calls[0].init?.method).toBe('POST');
      expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toEqual({
        conversa_id: 7,
        mime_type: 'application/pdf',
        size_bytes: 2048,
      });
      const authHeader = (fetchHarness.calls[0].init?.headers as Record<string, string>)
        .Authorization;
      expect(authHeader).toBe('Bearer token-de-teste');

      expect(String(fetchHarness.calls[1].input)).toContain('equipe-chat-media/finalize');
      expect(JSON.parse(String(fetchHarness.calls[1].init?.body))).toEqual({
        conversa_id: 7,
        key: 'equipe-chat/tmp/1.pdf',
        file_name: 'contrato.pdf',
        mime_type: 'application/pdf',
        size_bytes: 2048,
      });

      expect(MockXHR.instances).toHaveLength(1);
      expect(MockXHR.instances[0].method).toBe('PUT');
      expect(MockXHR.instances[0].url).toBe('https://upload.r2.dev/equipe-chat-1');
      expect(onProgress).toHaveBeenCalledWith({ loaded: 2048, total: 2048 });
    });

    it('propaga o erro quando o finalize falha', async () => {
      const file = createFile('contrato.pdf', 'application/pdf', 2048);

      fetchHarness.queueResponse({
        json: { upload_url: 'https://upload.r2.dev/equipe-chat-2', key: 'equipe-chat/tmp/2.pdf' },
      });
      fetchHarness.queueResponse({
        ok: false,
        status: 400,
        json: { error: 'Anexo inválido' },
      });

      await expect(uploadEquipeChatAnexo(7, file)).rejects.toThrow('Anexo inválido');
      expect(fetchHarness.calls).toHaveLength(2);
    });
  });

  describe('signEquipeChatAnexoView', () => {
    it('faz POST em anexo-url e devolve a url assinada', async () => {
      fetchHarness.queueResponse({ json: { url: 'https://cdn.example.com/anexo-9?sig=abc' } });

      const url = await signEquipeChatAnexoView(9);

      expect(url).toBe('https://cdn.example.com/anexo-9?sig=abc');
      expect(String(fetchHarness.calls[0].input)).toContain('equipe-chat-media/anexo-url');
      expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toEqual({ anexo_id: 9 });
    });
  });
});
