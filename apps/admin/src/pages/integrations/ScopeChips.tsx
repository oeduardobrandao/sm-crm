import { ADMIN_SCOPES } from '../../lib/mcp-admin-scopes';

/** The scopes an MCP connection can be granted, as mono chips (label on hover). */
export function ScopeChips() {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {ADMIN_SCOPES.map((scope) => (
        <li
          key={scope.value}
          title={scope.label}
          className="rounded-full bg-foreground/[0.12] px-2.5 py-[3px] font-mono text-xs text-foreground"
        >
          {scope.value}
        </li>
      ))}
    </ul>
  );
}
