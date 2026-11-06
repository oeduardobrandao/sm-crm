import { useId, useState, type ReactNode } from 'react';
import { SegmentedControl } from '@mesaas/ios-kit';
import { CONNECTOR_URL } from './shared';

type Client = 'claude-ai' | 'claude-code' | 'codex';

interface Step {
  text: ReactNode;
  code?: string;
}

const CLIENTS: { value: Client; label: string }[] = [
  { value: 'claude-ai', label: 'claude.ai' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
];

const STEPS: Record<Client, Step[]> = {
  'claude-ai': [
    { text: 'Abra Configurações › Conectores.' },
    { text: 'Escolha Adicionar conector personalizado e cole a URL acima.' },
    { text: 'Autorize o acesso e escolha Administração da plataforma.' },
  ],
  'claude-code': [
    {
      text: 'Rode o comando abaixo no terminal.',
      code: `claude mcp add --transport http mesaas-admin ${CONNECTOR_URL}`,
    },
    { text: 'Autorize o acesso e escolha Administração da plataforma.' },
  ],
  codex: [
    {
      text: (
        <>
          Adicione o bloco abaixo em <code className="font-mono">~/.codex/config.toml</code>.
        </>
      ),
      code: `[mcp_servers.mesaas_admin]\nurl = "${CONNECTOR_URL}"`,
    },
    { text: 'Autorize o acesso e escolha Administração da plataforma.' },
  ],
};

/** "Como conectar": a tablist over claude.ai / Claude Code / Codex with numbered steps. */
export function ConnectGuide() {
  const [client, setClient] = useState<Client>('claude-ai');
  const base = useId();
  const tabId = (value: Client) => `${base}-tab-${value}`;
  const panelId = `${base}-panel`;

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        aria-label="Cliente MCP"
        semantics="tablist"
        value={client}
        onChange={setClient}
        options={CLIENTS.map((c) => ({
          value: c.value,
          label: c.label,
          id: tabId(c.value),
          controls: panelId,
        }))}
      />
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(client)}>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {STEPS[client].map((step, index) => (
            <li key={index} className="flex gap-3 text-sm text-foreground">
              <span
                aria-hidden="true"
                className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-foreground/[0.12] text-xs font-bold"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                {step.text}
                {step.code ? (
                  <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
                    {step.code}
                  </pre>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
