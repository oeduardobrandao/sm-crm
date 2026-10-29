// Local harness (dev.html): each fixture through a fake host, light/dark toggle.
// Not part of the build output. Run: npx vite --config apps/mcp-widgets/vite.config.ts, open /dev.html
// The phone layout follows the viewport (as in the host iframe): narrow the window to see it.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { Host, ToolCallResult } from './bridge';
import './theme.css';
import preview from './__fixtures__/post_preview.json';
import over from './__fixtures__/post_preview_over.json';
import reels from './__fixtures__/post_preview_reels.json';
import options from './__fixtures__/caption_options.json';
import calendar from './__fixtures__/client_calendar.json';
import attach from './__fixtures__/attach_image.json';
import ineligible from './__fixtures__/attach_image_ineligible.json';
import sendResult from './__fixtures__/send_result.json';

const FIXTURES: Record<string, unknown> = {
  'Prévia (carrossel)': preview,
  'Prévia (legenda longa)': over,
  'Prévia (reels)': reels,
  'Opções de legenda': options,
  Calendário: calendar,
  'Anexar imagem': attach,
  'Anexar (não elegível)': ineligible,
  'Resultado do envio': sendResult,
  'Cartão desconhecido': { card: 'agenda', v: 1 },
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function devCall(name: string, args: Record<string, unknown>): ToolCallResult {
  console.info('[dev] callTool', name, args);
  if (name === 'create_post' || name === 'update_post') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            id: (args.post_id as number) ?? 901,
            titulo: args.titulo ?? 'Post',
            tipo: args.tipo ?? 'carrossel',
            status: 'rascunho',
          }),
        },
      ],
      _meta: { 'mesaas/sendNonce': 'dev-nonce' },
    };
  }
  if (name === 'send_post_to_client') {
    return {
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { card: 'send_result', v: 1, post_id: args.post_id, outcome: 'sent' },
    };
  }
  if (name === 'attach_image_to_post') {
    const url =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 5"><rect width="4" height="5" fill="#f4a261"/><circle cx="2" cy="2" r="1" fill="#e76f51"/></svg>',
      );
    return {
      content: [
        { type: 'text', text: JSON.stringify({ ok: true, ...args, image: undefined, url }) },
      ],
    };
  }
  return { content: [{ type: 'text', text: '{"ok":true}' }] };
}

function Harness() {
  const [key, setKey] = useState(Object.keys(FIXTURES)[0]);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const host: Host = {
    data: FIXTURES[key],
    meta: undefined,
    theme,
    callTool: async (name, args) => {
      await wait(400);
      return devCall(name, args as Record<string, unknown>);
    },
    sendMessage: async (text) => console.info('[dev] sendMessage', text),
    openLink: async (url) => console.info('[dev] openLink', url),
    pickImage: async () => ({ download_url: 'https://files.example/dev.png', file_id: 'file-dev' }),
  };
  return (
    <div
      style={{
        padding: 16,
        background: theme === 'dark' ? '#1f1f1e' : '#f4f4f2',
        minHeight: '100vh',
      }}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={key} onChange={(e) => setKey(e.target.value)}>
          {Object.keys(FIXTURES).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <button type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
          Tema: {theme === 'light' ? 'claro' : 'escuro'}
        </button>
      </div>
      <div style={{ maxWidth: 760 }}>
        <App key={key} host={host} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
