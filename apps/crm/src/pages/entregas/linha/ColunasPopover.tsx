import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  CheckSquare,
  ChevronDown,
  Columns3,
  Hash,
  Link,
  List,
  Loader2,
  MoreHorizontal,
  Plus,
  Type,
  User,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
  addColuna,
  excluirColuna,
  updateColuna,
  type LinhaColuna,
  type LinhaColunaPatch,
  type LinhaColunaTipo,
} from '@/store/linhaEditorial';
import type { SelectOption } from '@/store/posts';
import { normalizeNome } from './linhaLogic';
import { linhaColunasKey } from './useLinhaQueries';

// "Colunas" popover of the linha editorial (spec §6.3): a reduced PropertyDefinitionPanel that
// writes `linha_editorial_colunas`. The type grid and the option editor follow that panel.

const TIPOS: { tipo: LinhaColunaTipo; label: string; icon: ReactNode }[] = [
  { tipo: 'text', label: 'Texto', icon: <Type className="h-4 w-4" /> },
  { tipo: 'number', label: 'Número', icon: <Hash className="h-4 w-4" /> },
  { tipo: 'select', label: 'Seleção', icon: <ChevronDown className="h-4 w-4" /> },
  { tipo: 'multiselect', label: 'Multi-seleção', icon: <List className="h-4 w-4" /> },
  { tipo: 'date', label: 'Data', icon: <Calendar className="h-4 w-4" /> },
  { tipo: 'person', label: 'Pessoa', icon: <User className="h-4 w-4" /> },
  { tipo: 'checkbox', label: 'Checkbox', icon: <CheckSquare className="h-4 w-4" /> },
  { tipo: 'url', label: 'URL', icon: <Link className="h-4 w-4" /> },
];
const TIPO_LABEL = Object.fromEntries(TIPOS.map((t) => [t.tipo, t.label])) as Record<
  LinhaColunaTipo,
  string
>;

const CORES = ['#3b82f6', '#22c55e', '#f97316', '#8b5cf6', '#ec4899', '#eab308', '#ef4444'];

/** The fixed columns: always on every row. Only Direção can be hidden, and only here. */
const FIXAS = ['Data', 'Formato', 'Título', 'Direção do conteúdo'];

const MSG_DUPLICADA = 'Já existe uma coluna com esse nome.';

const temOpcoes = (tipo: LinhaColunaTipo) => tipo === 'select' || tipo === 'multiselect';
const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === '23505';

function OpcoesEditor({
  opcoes,
  onChange,
}: {
  opcoes: SelectOption[];
  onChange: (o: SelectOption[]) => void;
}) {
  const [nova, setNova] = useState('');
  const adicionar = () => {
    const label = nova.trim();
    if (!label) return;
    onChange([
      ...opcoes,
      { id: crypto.randomUUID(), label, color: CORES[opcoes.length % CORES.length] },
    ]);
    setNova('');
  };
  return (
    <div className="linha-opcoes">
      {opcoes.length > 0 && (
        <ul className="linha-opcoes__list">
          {opcoes.map((o) => (
            <li key={o.id} className="linha-opcoes__item">
              <span className="linha-opcoes__dot" style={{ background: o.color }} />
              <span className="linha-opcoes__label">{o.label}</span>
              <button
                type="button"
                className="linha-icon-btn linha-icon-btn--sm"
                aria-label={`Remover ${o.label}`}
                onClick={() => onChange(opcoes.filter((x) => x.id !== o.id))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="linha-opcoes__add">
        <input
          className="linha-input linha-input--boxed"
          aria-label="Nova opção"
          placeholder="Nova opção"
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              adicionar();
            }
          }}
        />
        <button type="button" className="linha-btn linha-btn--sm" onClick={adicionar}>
          Adicionar
        </button>
      </div>
    </div>
  );
}

type Modo =
  | { kind: 'nova' }
  | { kind: 'renomear'; id: string }
  | { kind: 'opcoes'; id: string }
  | { kind: 'excluir'; id: string }
  | null;

interface ColunasPopoverProps {
  colunas: LinhaColuna[];
  direcaoOculta: boolean;
  onDirecaoOcultaChange: (oculta: boolean) => void;
}

export function ColunasPopover({
  colunas,
  direcaoOculta,
  onDirecaoOcultaChange,
}: ColunasPopoverProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [modo, setModo] = useState<Modo>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Form state (Nova coluna and Renomear / Opções of an existing one).
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<LinhaColunaTipo>('text');
  const [opcoes, setOpcoes] = useState<SelectOption[]>([]);
  const [visivel, setVisivel] = useState(true);

  const extras = [...colunas].sort((a, b) => a.ordem - b.ordem);

  const abrirModo = (m: Modo, col?: LinhaColuna) => {
    setErro(null);
    setModo(m);
    setNome(col?.nome ?? '');
    setTipo(col?.tipo ?? 'text');
    setOpcoes(col?.config?.options ?? []);
    setVisivel(col?.visivel_cliente ?? true);
  };

  const nomeDuplicado = (n: string, exceto?: string) => {
    const k = normalizeNome(n);
    return (
      FIXAS.some((f) => normalizeNome(f) === k) ||
      colunas.some((c) => c.id !== exceto && normalizeNome(c.nome) === k)
    );
  };

  const invalidar = () => void qc.invalidateQueries({ queryKey: linhaColunasKey });

  const atualizar = async (id: string, patch: LinhaColunaPatch): Promise<boolean> => {
    qc.setQueryData<LinhaColuna[]>(linhaColunasKey, (l) =>
      l?.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
    try {
      await trackUnsavedWork(updateColuna(id, patch));
      return true;
    } catch (err) {
      invalidar();
      if (isUniqueViolation(err)) setErro(MSG_DUPLICADA);
      else toast.error('Não foi possível salvar a coluna. Tente de novo.');
      return false;
    }
  };

  const criar = async () => {
    const n = nome.trim();
    if (!n || salvando) return;
    if (nomeDuplicado(n)) {
      setErro(MSG_DUPLICADA);
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await trackUnsavedWork(
        addColuna({
          nome: n,
          tipo,
          config: temOpcoes(tipo) ? { options: opcoes } : {},
          visivel_cliente: visivel,
        }),
      );
      invalidar();
      setModo(null);
    } catch (err) {
      if (isUniqueViolation(err)) setErro(MSG_DUPLICADA);
      else toast.error('Não foi possível criar a coluna. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const renomear = async (col: LinhaColuna) => {
    const n = nome.trim();
    if (!n || n === col.nome) {
      setModo(null);
      return;
    }
    if (nomeDuplicado(n, col.id)) {
      setErro(MSG_DUPLICADA);
      return;
    }
    setSalvando(true);
    const ok = await atualizar(col.id, { nome: n });
    setSalvando(false);
    if (ok) setModo(null);
  };

  const salvarOpcoes = async (col: LinhaColuna) => {
    setSalvando(true);
    const ok = await atualizar(col.id, { config: { ...col.config, options: opcoes } });
    setSalvando(false);
    if (ok) setModo(null);
  };

  const excluir = async (col: LinhaColuna) => {
    setSalvando(true);
    try {
      await trackUnsavedWork(excluirColuna(col.id));
      invalidar();
      // The RPC strips the column's key from unconverted rows' valores.
      void qc.invalidateQueries({ queryKey: ['linha-itens'] });
      setModo(null);
    } catch {
      toast.error('Não foi possível excluir a coluna. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const erroEl = erro && (
    <p className="linha-colunas__erro" role="alert">
      {erro}
    </p>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setModo(null);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="linha-btn">
          <Columns3 className="h-4 w-4" />
          Colunas
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="linha-colunas" aria-label="Colunas da linha editorial">
        <p className="linha-colunas__title">Colunas da linha editorial</p>

        <ul className="linha-colunas__list">
          {FIXAS.map((f) => (
            <li key={f} className="linha-colunas__item">
              <span className="linha-colunas__nome">{f}</span>
              {f === 'Direção do conteúdo' ? (
                <Switch
                  aria-label="Mostrar Direção do conteúdo na tabela"
                  checked={!direcaoOculta}
                  onCheckedChange={(on) => onDirecaoOcultaChange(!on)}
                />
              ) : (
                <span className="linha-colunas__fixa">fixa</span>
              )}
            </li>
          ))}
        </ul>

        {extras.length > 0 && (
          <ul className="linha-colunas__list">
            {extras.map((col) => (
              <li key={col.id} className="linha-colunas__bloco">
                <div className="linha-colunas__item">
                  <span className="linha-colunas__nome">
                    {col.nome}
                    <span className="linha-colunas__tipo">{TIPO_LABEL[col.tipo]}</span>
                  </span>
                  <Switch
                    aria-label={`Mostrar ${col.nome} na tabela`}
                    checked={!col.oculta}
                    onCheckedChange={(on) => void atualizar(col.id, { oculta: !on })}
                  />
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="linha-icon-btn"
                        aria-label={`Ações da coluna ${col.nome}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => abrirModo({ kind: 'renomear', id: col.id }, col)}
                      >
                        Renomear
                      </DropdownMenuItem>
                      {temOpcoes(col.tipo) && (
                        <DropdownMenuItem
                          onSelect={() => abrirModo({ kind: 'opcoes', id: col.id }, col)}
                        >
                          Opções
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuCheckboxItem
                        checked={col.visivel_cliente}
                        onCheckedChange={(on) => void atualizar(col.id, { visivel_cliente: on })}
                      >
                        Visível para o cliente
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onSelect={() => abrirModo({ kind: 'excluir', id: col.id }, col)}
                      >
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {modo?.kind === 'renomear' && modo.id === col.id && (
                  <form
                    className="linha-colunas__form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void renomear(col);
                    }}
                  >
                    <input
                      className="linha-input linha-input--boxed"
                      aria-label="Novo nome da coluna"
                      value={nome}
                      autoFocus
                      onChange={(e) => {
                        setNome(e.target.value);
                        setErro(null);
                      }}
                    />
                    {erroEl}
                    <div className="linha-colunas__acoes">
                      <button
                        type="button"
                        className="linha-btn linha-btn--sm"
                        onClick={() => setModo(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="linha-btn linha-btn--sm linha-btn--primary"
                        disabled={salvando || !nome.trim()}
                      >
                        Salvar
                      </button>
                    </div>
                  </form>
                )}

                {modo?.kind === 'opcoes' && modo.id === col.id && (
                  <div className="linha-colunas__form">
                    <OpcoesEditor opcoes={opcoes} onChange={setOpcoes} />
                    <div className="linha-colunas__acoes">
                      <button
                        type="button"
                        className="linha-btn linha-btn--sm"
                        onClick={() => setModo(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="linha-btn linha-btn--sm linha-btn--primary"
                        disabled={salvando}
                        onClick={() => void salvarOpcoes(col)}
                      >
                        Salvar opções
                      </button>
                    </div>
                  </div>
                )}

                {modo?.kind === 'excluir' && modo.id === col.id && (
                  <div className="linha-colunas__form linha-colunas__confirm" role="group">
                    <p className="linha-colunas__texto">
                      Excluir a coluna “{col.nome}”? Os valores dela saem das linhas que ainda não
                      viraram post.
                    </p>
                    <div className="linha-colunas__acoes">
                      <button
                        type="button"
                        className="linha-btn linha-btn--sm"
                        onClick={() => setModo(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="linha-btn linha-btn--sm linha-btn--danger"
                        disabled={salvando}
                        onClick={() => void excluir(col)}
                      >
                        {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Excluir coluna
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {modo?.kind === 'nova' ? (
          <form
            className="linha-colunas__form"
            onSubmit={(e) => {
              e.preventDefault();
              void criar();
            }}
          >
            <input
              className="linha-input linha-input--boxed"
              aria-label="Nome da coluna"
              placeholder="Nome da coluna"
              value={nome}
              autoFocus
              onChange={(e) => {
                setNome(e.target.value);
                setErro(null);
              }}
            />
            {erroEl}
            <div className="linha-colunas__tipos" role="group" aria-label="Tipo da coluna">
              {TIPOS.map((t) => (
                <button
                  key={t.tipo}
                  type="button"
                  className={`linha-colunas__tipo-btn${tipo === t.tipo ? ' is-active' : ''}`}
                  aria-pressed={tipo === t.tipo}
                  onClick={() => setTipo(t.tipo)}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
            {temOpcoes(tipo) && <OpcoesEditor opcoes={opcoes} onChange={setOpcoes} />}
            <label className="linha-colunas__check">
              <input
                type="checkbox"
                className="linha-check"
                checked={visivel}
                onChange={(e) => setVisivel(e.target.checked)}
              />
              Visível para o cliente
            </label>
            <div className="linha-colunas__acoes">
              <button
                type="button"
                className="linha-btn linha-btn--sm"
                onClick={() => setModo(null)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="linha-btn linha-btn--sm linha-btn--primary"
                disabled={salvando || !nome.trim()}
              >
                {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Criar coluna
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="linha-btn linha-btn--sm linha-colunas__nova"
            onClick={() => abrirModo({ kind: 'nova' })}
          >
            <Plus className="h-4 w-4" />
            Nova coluna
          </button>
        )}

        <p className="linha-colunas__nota">Valem para todas as linhas da agência.</p>
      </PopoverContent>
    </Popover>
  );
}
