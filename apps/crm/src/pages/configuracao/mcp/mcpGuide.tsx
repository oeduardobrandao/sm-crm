// Conteúdo de "Como conectar" e dos snippets de conexão, compartilhado pela tela de
// desktop (IntegracoesClaudePage) e pela de celular (IntegracoesClaudePhone): os
// passos e os textos de configuração existem num lugar só.
import type { ReactNode } from 'react';

export const MCP_URL = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/mcp';
export const MESAAS_LOGO_URL = 'https://www.mesaas.com.br/mesaas-icon-256.png';

export const codexConfigToml = (token: string) =>
  `[mcp_servers.mesaas]
url = "${MCP_URL}"

[mcp_servers.mesaas.http_headers]
Authorization = "Bearer ${token}"`;

export type McpClient = 'claude' | 'chatgpt' | 'codex';

export const CLIENT_TABS: { id: McpClient; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'codex', label: 'Codex' },
];

/** The Claude Desktop config block and the Claude Code command for a token. */
export function buildConnectSnippets(token: string) {
  const desktopConfig = JSON.stringify(
    {
      mcpServers: {
        mesaas: {
          command: 'npx',
          args: ['-y', 'mcp-remote', MCP_URL, '--header', 'Authorization:${AUTH_HEADER}'],
          env: { AUTH_HEADER: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
  const claudeCodeCmd = `claude mcp add --transport http mesaas ${MCP_URL} --header "Authorization: Bearer ${token}"`;
  return { desktopConfig, claudeCodeCmd, codexToml: codexConfigToml(token) };
}

/** Steps of the Claude guide (the `<li>`s of the ordered list). */
export function ClaudeSteps() {
  return (
    <>
      <li>
        <span>
          No claude.ai ou no Claude Desktop, abra{' '}
          <strong>Configurações → Conectores → Adicionar conector personalizado</strong>.
        </span>
      </li>
      <li>
        <span>
          Cole a URL abaixo, deixe os campos de OAuth em branco e clique em{' '}
          <strong>Adicionar</strong>.
        </span>
      </li>
      <li>
        <span>
          Faça login no Mesaas, escolha o workspace e as permissões e clique em{' '}
          <strong>Autorizar</strong>.
        </span>
      </li>
    </>
  );
}

/** Steps of the ChatGPT guide. */
export function ChatgptSteps() {
  return (
    <>
      <li>
        <span>
          No ChatGPT, abra <strong>Configurações → Security and login</strong> e ative o{' '}
          <strong>Developer mode</strong> (opção marcada como "elevated risk"; também acessível em{' '}
          <strong>Configurações → Plugins</strong>).
        </span>
      </li>
      <li>
        <span>
          Abra <strong>chatgpt.com/plugins</strong>, clique no botão <strong>+</strong> e, no
          diálogo <strong>New Plugin</strong>, dê o nome "Mesaas", cole a URL abaixo em{' '}
          <strong>MCP Server URL</strong> e escolha <strong>OAuth</strong> como autenticação.
        </span>
      </li>
      <li>
        <span>
          Opcional: para o conector aparecer com a nossa marca,{' '}
          <a
            href={MESAAS_LOGO_URL}
            target="_blank"
            rel="noreferrer"
            className="underline text-primary"
          >
            baixe a logo do Mesaas (PNG)
          </a>{' '}
          e envie no campo <strong>Icon</strong>. O ícone só pode ser definido nesse passo: depois
          de criado o conector, não dá para trocar.
        </span>
      </li>
      <li>
        <span>
          Marque a confirmação de risco, clique em <strong>Create</strong> e depois em{' '}
          <strong>Sign in with Mesaas</strong>: faça login, escolha o workspace e as permissões e
          clique em <strong>Autorizar</strong>.
        </span>
      </li>
      <li>
        <span>
          Na conversa, clique no botão <strong>+</strong> do campo de mensagem e ative o{' '}
          <strong>Mesaas</strong>.
        </span>
      </li>
    </>
  );
}

/** Steps of the Codex guide. */
export function CodexSteps() {
  return (
    <>
      <li>
        <span>
          Crie uma chave em <strong>Chaves de API</strong> abaixo e copie o valor (ele aparece uma
          única vez).
        </span>
      </li>
      <li>
        <span>
          Adicione o bloco abaixo ao arquivo <code>~/.codex/config.toml</code>, trocando{' '}
          <code>SUA_CHAVE</code> pela chave copiada.
        </span>
      </li>
      <li>
        <span>
          Abra o Codex e confirme com <code>/mcp</code> que o servidor <strong>mesaas</strong>{' '}
          aparece na lista.
        </span>
      </li>
    </>
  );
}

/** Line above each guide's steps. */
export const CLIENT_INTRO: Record<McpClient, ReactNode> = {
  claude: 'Sem chave: a conexão usa OAuth e pode ser revogada aqui a qualquer momento.',
  chatgpt:
    'Sem chave: a conexão usa OAuth. Requer o modo de desenvolvedor do ChatGPT (não exige plano pago).',
  codex:
    'O Codex CLI conecta com uma chave de API deste workspace, direto via HTTP (sem dependências extras).',
};

/** Note under the Claude guide's URL. */
export function ClaudeKeyNote() {
  return (
    <>
      Claude Code, API ou agentes headless usam uma chave: crie uma em{' '}
      <strong>Chaves de API</strong> abaixo e copie o comando pronto.
    </>
  );
}

/** Note under the Codex guide's config block. */
export function CodexHeadersNote() {
  return (
    <>
      Use <code>http_headers</code> como no bloco: o campo <code>bearer_token</code> não é aceito
      para servidores HTTP.
    </>
  );
}

/** Closing line of "Como conectar". */
export function TryItNote() {
  return (
    <>
      Depois, peça ao assistente: <em>"liste meus clientes ativos"</em> ou{' '}
      <em>"mostre o post X com métricas"</em>.
    </>
  );
}

/** Footnote of the reveal and connect panels. */
export const KEY_USAGE_NOTE =
  'Esta chave é para Claude Code, Codex, API ou agentes headless. No claude.ai, Claude Desktop ou ChatGPT, conecte pelo conector (sem chave): veja "Como conectar".';
