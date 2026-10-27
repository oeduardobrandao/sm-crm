import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { ClienteFoto } from '@/components/ClienteFoto';
import { useClienteAvatars } from '@/hooks/useClienteAvatars';
import type { Cliente } from '@/store';
import type { LinhaEditorial } from '@/store/linhaEditorial';
import { LinhaStatusBadge } from './LinhaStatusBadge';
import { mesTitulo, shiftMes } from './mesNav';

interface LinhaClientRailProps {
  clientes: Cliente[];
  /** Month's linhas, one per client at most. */
  linhas: LinhaEditorial[];
  /** `YYYY-MM`. */
  mes: string;
  selectedId: number | null;
  /** Client whose "Criar" is in flight. */
  criandoId: number | null;
  /** The month's linhas are still loading: rows show no status and no "Criar" yet. */
  carregando?: boolean;
  onSelect: (clienteId: number) => void;
  onCriar: (clienteId: number) => void;
  onMesChange: (mes: string) => void;
}

function contagem(l: LinhaEditorial): string {
  const total = l.itens_total ?? 0;
  const prod = l.itens_convertidos ?? 0;
  if (prod > 0) return `${prod} de ${total} em produção`;
  return `${total} ${total === 1 ? 'post' : 'posts'}`;
}

export function LinhaClientRail({
  clientes,
  linhas,
  mes,
  selectedId,
  criandoId,
  carregando = false,
  onSelect,
  onCriar,
  onMesChange,
}: LinhaClientRailProps) {
  const { fotosDe } = useClienteAvatars(clientes);
  const linhaPorCliente = useMemo(() => new Map(linhas.map((l) => [l.cliente_id, l])), [linhas]);
  // Clients with a linha first, then alphabetical inside each group.
  const ordenados = useMemo(
    () =>
      [...clientes]
        .filter((c) => c.id != null)
        .sort((a, b) => {
          const ha = linhaPorCliente.has(a.id!) ? 0 : 1;
          const hb = linhaPorCliente.has(b.id!) ? 0 : 1;
          return ha - hb || a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
        }),
    [clientes, linhaPorCliente],
  );

  return (
    <aside className="linha-rail" data-testid="linha-rail">
      <div className="linha-rail__mes">
        <button
          type="button"
          className="linha-icon-btn"
          aria-label="Mês anterior"
          onClick={() => onMesChange(shiftMes(mes, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="linha-rail__mes-label">{mesTitulo(mes)}</span>
        <button
          type="button"
          className="linha-icon-btn"
          aria-label="Próximo mês"
          onClick={() => onMesChange(shiftMes(mes, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <ul className="linha-rail__list">
        {ordenados.map((c) => {
          const linha = linhaPorCliente.get(c.id!);
          const ativo = c.id === selectedId;
          return (
            <li key={c.id} className={`linha-rail__item${ativo ? ' is-active' : ''}`}>
              <button
                type="button"
                className="linha-rail__select"
                aria-current={ativo ? 'true' : undefined}
                onClick={() => onSelect(c.id!)}
              >
                <ClienteFoto
                  srcs={fotosDe(c)}
                  className="linha-avatar"
                  fallback={
                    <span className="linha-avatar" style={{ background: c.cor }}>
                      {c.sigla}
                    </span>
                  }
                />
                <span className="linha-rail__text">
                  <span className="linha-rail__name" data-testid="linha-rail-name">
                    {c.nome}
                  </span>
                  {linha ? (
                    <span className="linha-rail__meta">
                      <LinhaStatusBadge status={linha.status} />
                      <span>{contagem(linha)}</span>
                    </span>
                  ) : carregando ? null : (
                    <span className="linha-rail__meta">Sem linha neste mês</span>
                  )}
                </span>
              </button>
              {!linha && !carregando && (
                <button
                  type="button"
                  className="linha-rail__criar"
                  disabled={criandoId === c.id}
                  onClick={() => onCriar(c.id!)}
                >
                  {criandoId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Criar
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
