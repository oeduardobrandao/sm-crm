import { useState } from 'react';
import { useHub } from '../HubContext';

interface Message {
  id: number;
  from: 'me' | 'them';
  text: string;
  time: string;
}

const SEED_MESSAGES: Message[] = [
  { id: 1, from: 'them', text: 'Oi! Subi o reels, dá uma olhada.', time: '10:42' },
  { id: 2, from: 'me', text: 'Aprovado! Só troca o CTA no final.', time: '10:58' },
  { id: 3, from: 'them', text: 'Feito! Subi a nova versão.', time: '11:04' },
];

export function MensagensPage() {
  const { bootstrap } = useHub();
  const [messages, setMessages] = useState<Message[]>(SEED_MESSAGES);
  const [draft, setDraft] = useState('');

  function send() {
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { id: prev.length + 1, from: 'me', text, time: 'agora' }]);
    setDraft('');
  }

  // Guard the route itself, not just the nav link — a workspace without the
  // feature shouldn't be able to reach it by navigating to the URL directly.
  if (!bootstrap.feature_mensagens) {
    return (
      <div className="flex flex-col gap-4 hub-fade-up">
        <header>
          <h1 className="font-display text-[1.7rem] sm:text-[2.4rem] font-medium tracking-tight hub-txt">
            Mensagens
          </h1>
        </header>
        <p className="text-sm hub-tx2">
          Este recurso ainda não está disponível no seu plano. Fale com sua agência para saber mais.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 hub-fade-up">
      <header>
        <h1 className="font-display text-[1.7rem] sm:text-[2.4rem] font-medium tracking-tight hub-txt">
          Mensagens
        </h1>
      </header>
      <div className="hub-card flex flex-col min-h-[480px] overflow-hidden">
        <div className="flex items-center gap-3 px-[18px] py-3.5 border-b hub-border">
          <div className="w-[38px] h-[38px] rounded-full hub-bg-soft flex items-center justify-center text-[13px] font-semibold hub-txt">
            {bootstrap.cliente_nome
              .split(' ')
              .slice(0, 2)
              .map((p) => p.charAt(0).toUpperCase())
              .join('')}
          </div>
          <div className="flex-1">
            <div className="font-semibold text-[15px] hub-txt">{bootstrap.cliente_nome}</div>
            <div className="text-[12px] hub-tx3">Online</div>
          </div>
        </div>
        <div
          className="flex-1 overflow-y-auto p-5 flex flex-col gap-3"
          style={{ background: 'var(--hub-bg)' }}
        >
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[72%] ${m.from === 'me' ? 'self-end' : 'self-start'}`}
            >
              <div
                className={`px-3.5 py-2.5 rounded-2xl text-sm ${
                  m.from === 'me' ? 'hub-btn-primary' : 'hub-bg-card'
                }`}
                style={
                  m.from === 'them' ? { boxShadow: 'inset 0 0 0 1px var(--hub-bd)' } : undefined
                }
              >
                {m.text}
              </div>
              <span
                className={`block mt-1 text-[11px] hub-tx3 ${m.from === 'me' ? 'text-right' : 'text-left'}`}
              >
                {m.time}
              </span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 p-3.5 border-t hub-border">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            placeholder="Enviar mensagem…"
            className="flex-1 px-[18px] py-3 rounded-full border hub-border-strong text-sm outline-none"
            style={{ background: 'var(--hub-bg)', color: 'var(--hub-txt)' }}
          />
          <button
            onClick={send}
            className="px-5 py-3 rounded-full text-[13px] font-semibold hub-btn-primary"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
