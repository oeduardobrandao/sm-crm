import { useId } from 'react';
import { X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { avatarColorClass } from '@/lib/avatarColor';
import type { Membro } from '../../../store';

// Iniciais locais em vez do getInitials do store: EntregasPage.test mocka o
// store inteiro, e um import de valor de lá chegaria undefined no render.
function initials(nome: string): string {
  return nome
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// Ordem alfabética pt-BR, sem diferenciar acento nem caixa (como FilaMembroPicker).
const byNome = (a: Membro, b: Membro) =>
  a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });

/**
 * Painel "Responsáveis" da vista Lista: cada membro com quantas linhas estão
 * com ele e um checkbox que é o MESMO estado do filtro "Responsável"
 * (filterMembros). As contagens chegam prontas da página e ignoram o próprio
 * filtro de responsável: marcar a Ana não zera os números dos outros.
 */
export function ResponsaveisPanel({
  membros,
  counts,
  selected,
  onChange,
  caption,
  onClose,
}: {
  membros: Membro[];
  counts: ReadonlyMap<number, number>;
  selected: number[];
  onChange: (ids: number[]) => void;
  /** De quem é a contagem neste modo da Lista. */
  caption: string;
  /** Painel lateral (desktop): botão X. No Sheet do celular o Sheet fecha sozinho. */
  onClose?: () => void;
}) {
  // Prefixo único por instância do painel: a contagem de cada membro vira a
  // descrição do checkbox dele (aria-describedby), e dois painéis na página não
  // podem repetir o id.
  const panelId = useId();
  const sorted = membros.filter((m) => m.id != null).sort(byNome);
  const toggle = (id: number, checked: boolean) =>
    onChange(checked ? [...selected, id] : selected.filter((s) => s !== id));

  return (
    <div className="flex flex-col gap-3">
      {/* Sem onClose o painel está no Sheet do celular, cujo X fica no canto
          superior direito: pr-8 tira o "Limpar" de baixo dele. */}
      <div className={`flex items-start justify-between gap-2${onClose ? '' : ' pr-8'}`}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>
            Responsáveis
          </h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {caption}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {selected.length > 0 && (
            <button
              type="button"
              className="text-xs underline"
              style={{ color: 'var(--text-muted)', background: 'none', border: 'none' }}
              onClick={() => onChange([])}
            >
              Limpar
            </button>
          )}
          {onClose && (
            <button
              type="button"
              aria-label="Fechar painel de responsáveis"
              onClick={onClose}
              className="rounded-md p-1 hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text-muted)' }}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Nenhum membro na equipe.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {sorted.map((m) => {
            const id = m.id!;
            const countId = `${panelId}-count-${id}`;
            return (
              <li key={id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-hover)]">
                  <span
                    className={`avatar ${avatarColorClass(id)}`}
                    style={{ width: 22, height: 22, fontSize: '0.55rem', flexShrink: 0 }}
                    aria-hidden="true"
                  >
                    {initials(m.nome)}
                  </span>
                  <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-main)' }}>
                    {m.nome}
                  </span>
                  <span
                    id={countId}
                    className="text-xs tabular-nums"
                    style={{ color: 'var(--text-muted)' }}
                    data-testid="responsavel-count"
                  >
                    {counts.get(id) ?? 0}
                  </span>
                  <Checkbox
                    aria-label={m.nome}
                    aria-describedby={countId}
                    checked={selected.includes(id)}
                    onCheckedChange={(v) => toggle(id, v === true)}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
