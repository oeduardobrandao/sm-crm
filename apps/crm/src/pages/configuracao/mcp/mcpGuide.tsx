// Conteúdo de "Como conectar" e dos snippets de conexão, compartilhado pela tela de
// desktop (IntegracoesClaudePage) e pela de celular (IntegracoesClaudePhone): os
// passos e os textos de configuração existem num lugar só.
import { Trans, useTranslation } from 'react-i18next';

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

/** Page intro with `configuracoes:ver` (keys + every connection) vs. for any other member. */
export function ManagerIntro() {
  const { t } = useTranslation('mcp');
  return <>{t('guide.managerIntro')}</>;
}
export function MemberIntro() {
  const { t } = useTranslation('mcp');
  return <>{t('guide.memberIntro')}</>;
}

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

const B = <strong />;
const C = <code />;

/** Steps of the Claude guide (the `<li>`s of the ordered list). */
export function ClaudeSteps() {
  const { t } = useTranslation('mcp');
  return (
    <>
      {(['step1', 'step2', 'step3'] as const).map((step) => (
        <li key={step}>
          <span>
            <Trans t={t} i18nKey={`guide.claudeSteps.${step}`} components={{ b: B }} />
          </span>
        </li>
      ))}
    </>
  );
}

/** Steps of the ChatGPT guide. */
export function ChatgptSteps() {
  const { t } = useTranslation('mcp');
  return (
    <>
      {(['step1', 'step2', 'step3', 'step4', 'step5'] as const).map((step) => (
        <li key={step}>
          <span>
            <Trans
              t={t}
              i18nKey={`guide.chatgptSteps.${step}`}
              components={{
                b: B,
                logo: (
                  <a
                    href={MESAAS_LOGO_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-primary"
                  />
                ),
              }}
            />
          </span>
        </li>
      ))}
    </>
  );
}

/** Steps of the Codex guide. */
export function CodexSteps() {
  const { t } = useTranslation('mcp');
  return (
    <>
      {(['step1', 'step2', 'step3'] as const).map((step) => (
        <li key={step}>
          <span>
            <Trans t={t} i18nKey={`guide.codexSteps.${step}`} components={{ b: B, c: C }} />
          </span>
        </li>
      ))}
    </>
  );
}

/** Line above each guide's steps. */
export function ClientIntro({ client }: { client: McpClient }) {
  const { t } = useTranslation('mcp');
  return <>{t(`guide.clientIntro.${client}`)}</>;
}

/** Note under the Claude guide's URL. */
export function ClaudeKeyNote() {
  const { t } = useTranslation('mcp');
  return <Trans t={t} i18nKey="guide.claudeKeyNote" components={{ b: B }} />;
}

/** Note under the Codex guide's config block. */
export function CodexHeadersNote() {
  const { t } = useTranslation('mcp');
  return <Trans t={t} i18nKey="guide.codexHeadersNote" components={{ c: C }} />;
}

/** Closing line of "Como conectar". */
export function TryItNote() {
  const { t } = useTranslation('mcp');
  return <Trans t={t} i18nKey="guide.tryIt" components={{ em: <em /> }} />;
}

/** Footnote of the reveal and connect panels. */
export function KeyUsageNote() {
  const { t } = useTranslation('mcp');
  return <>{t('guide.keyUsageNote')}</>;
}
