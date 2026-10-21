import { ADMIN_SCOPES } from '../../lib/mcp-admin-scopes';

/** The scopes an MCP connection can be granted: mono chip plus its label as visible text. */
export function ScopeChips() {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {ADMIN_SCOPES.map((scope) => (
        <li key={scope.value} className="flex items-center gap-2 text-sm">
          <span className="rounded-full bg-foreground/[0.12] px-2.5 py-[3px] font-mono text-xs text-foreground">
            {scope.value}
          </span>
          <span className="text-foreground">{scope.label}</span>
        </li>
      ))}
    </ul>
  );
}
