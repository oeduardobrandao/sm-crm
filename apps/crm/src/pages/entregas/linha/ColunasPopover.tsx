import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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

// Labels come from `linha:shared.tipoColuna.<tipo>`.
const TIPOS: { tipo: LinhaColunaTipo; icon: ReactNode }[] = [
  { tipo: 'text', icon: <Type className="h-4 w-4" /> },
  { tipo: 'number', icon: <Hash className="h-4 w-4" /> },
  { tipo: 'select', icon: <ChevronDown className="h-4 w-4" /> },
  { tipo: 'multiselect', icon: <List className="h-4 w-4" /> },
  { tipo: 'date', icon: <Calendar className="h-4 w-4" /> },
  { tipo: 'person', icon: <User className="h-4 w-4" /> },
  { tipo: 'checkbox', icon: <CheckSquare className="h-4 w-4" /> },
  { tipo: 'url', icon: <Link className="h-4 w-4" /> },
];

const CORES = ['#3b82f6', '#22c55e', '#f97316', '#8b5cf6', '#ec4899', '#eab308', '#ef4444'];

/**
 * The fixed columns (`linha:shared.fixas.<key>`): always on every row. Only Direção can be
 * hidden, and only here.
 */
const FIXAS = ['data', 'formato', 'titulo', 'direcao'] as const;

const temOpcoes = (tipo: LinhaColunaTipo) => tipo === 'select' || tipo === 'multiselect';
const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === '23505';

function OpcoesEditor({
  opcoes,
  onChange,
}: {
  opcoes: SelectOption[];
  onChange: (o: SelectOption[]) => void;
}) {
  const { t } = useTranslation('linha');
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
                aria-label={t('colunasPopover.removerOpcao', { label: o.label })}
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
          aria-label={t('colunasPopover.novaOpcao')}
          placeholder={t('colunasPopover.novaOpcao')}
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
          {t('actions.add')}
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
  const { t } = useTranslation('linha');
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

  const msgDuplicada = t('colunasPopover.duplicada');
  const fixaLabel = (f: (typeof FIXAS)[number]) => t(`shared.fixas.${f}`);

  const nomeDuplicado = (n: string, exceto?: string) => {
    const k = normalizeNome(n);
    // Both the shown name and the Portuguese one: column names are shared by the agency.
    return (
      FIXAS.some(
        (f) =>
          normalizeNome(fixaLabel(f)) === k ||
          normalizeNome(t(`shared.fixas.${f}`, { lng: 'pt' })) === k,
      ) || colunas.some((c) => c.id !== exceto && normalizeNome(c.nome) === k)
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
      if (isUniqueViolation(err)) setErro(msgDuplicada);
      else toast.error(t('colunasPopover.erroSalvar'));
      return false;
    }
  };

  const criar = async () => {
    const n = nome.trim();
    if (!n || salvando) return;
    if (nomeDuplicado(n)) {
      setErro(msgDuplicada);
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
      if (isUniqueViolation(err)) setErro(msgDuplicada);
      else toast.error(t('colunasPopover.erroCriar'));
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
      setErro(msgDuplicada);
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
      toast.error(t('colunasPopover.erroExcluir'));
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
          {t('shared.colunas')}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="linha-colunas" aria-label={t('colunasPopover.titulo')}>
        <p className="linha-colunas__title">{t('colunasPopover.titulo')}</p>

        <ul className="linha-colunas__list">
          {FIXAS.map((f) => (
            <li key={f} className="linha-colunas__item">
              <span className="linha-colunas__nome">{fixaLabel(f)}</span>
              {f === 'direcao' ? (
                <Switch
                  aria-label={t('colunasPopover.mostrarDirecao')}
                  checked={!direcaoOculta}
                  onCheckedChange={(on) => onDirecaoOcultaChange(!on)}
                />
              ) : (
                <span className="linha-colunas__fixa">{t('colunasPopover.fixa')}</span>
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
                    <span className="linha-colunas__tipo">
                      {t(`shared.tipoColuna.${col.tipo}`)}
                    </span>
                  </span>
                  <Switch
                    aria-label={t('colunasPopover.mostrarColuna', { nome: col.nome })}
                    checked={!col.oculta}
                    onCheckedChange={(on) => void atualizar(col.id, { oculta: !on })}
                  />
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="linha-icon-btn"
                        aria-label={t('colunasPopover.acoesColuna', { nome: col.nome })}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    {/* Above the Popover (z-[9012]); the menu's default z-[9011] opens behind it. */}
                    <DropdownMenuContent align="end" className="z-[9013]">
                      <DropdownMenuItem
                        onSelect={() => abrirModo({ kind: 'renomear', id: col.id }, col)}
                      >
                        {t('colunasPopover.renomear')}
                      </DropdownMenuItem>
                      {temOpcoes(col.tipo) && (
                        <DropdownMenuItem
                          onSelect={() => abrirModo({ kind: 'opcoes', id: col.id }, col)}
                        >
                          {t('colunasPopover.opcoes')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuCheckboxItem
                        checked={col.visivel_cliente}
                        onCheckedChange={(on) => void atualizar(col.id, { visivel_cliente: on })}
                      >
                        {t('colunasPopover.visivelCliente')}
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onSelect={() => abrirModo({ kind: 'excluir', id: col.id }, col)}
                      >
                        {t('shared.excluir')}
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
                      aria-label={t('colunasPopover.novoNome')}
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
                        {t('actions.cancel')}
                      </button>
                      <button
                        type="submit"
                        className="linha-btn linha-btn--sm linha-btn--primary"
                        disabled={salvando || !nome.trim()}
                      >
                        {t('actions.save')}
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
                        {t('actions.cancel')}
                      </button>
                      <button
                        type="button"
                        className="linha-btn linha-btn--sm linha-btn--primary"
                        disabled={salvando}
                        onClick={() => void salvarOpcoes(col)}
                      >
                        {t('colunasPopover.salvarOpcoes')}
                      </button>
                    </div>
                  </div>
                )}

                {modo?.kind === 'excluir' && modo.id === col.id && (
                  <div className="linha-colunas__form linha-colunas__confirm" role="group">
                    <p className="linha-colunas__texto">
                      {t('colunasPopover.confirmarExcluir', { nome: col.nome })}
                    </p>
                    <div className="linha-colunas__acoes">
                      <button
                        type="button"
                        className="linha-btn linha-btn--sm"
                        onClick={() => setModo(null)}
                      >
                        {t('actions.cancel')}
                      </button>
                      <button
                        type="button"
                        className="linha-btn linha-btn--sm linha-btn--danger"
                        disabled={salvando}
                        onClick={() => void excluir(col)}
                      >
                        {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {t('colunasPopover.excluirColuna')}
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
              aria-label={t('colunasPopover.nomeColuna')}
              placeholder={t('colunasPopover.nomeColuna')}
              value={nome}
              autoFocus
              onChange={(e) => {
                setNome(e.target.value);
                setErro(null);
              }}
            />
            {erroEl}
            <div
              className="linha-colunas__tipos"
              role="group"
              aria-label={t('colunasPopover.tipoColuna')}
            >
              {TIPOS.map((op) => (
                <button
                  key={op.tipo}
                  type="button"
                  className={`linha-colunas__tipo-btn${tipo === op.tipo ? ' is-active' : ''}`}
                  aria-pressed={tipo === op.tipo}
                  onClick={() => setTipo(op.tipo)}
                >
                  {op.icon}
                  {t(`shared.tipoColuna.${op.tipo}`)}
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
              {t('colunasPopover.visivelCliente')}
            </label>
            <div className="linha-colunas__acoes">
              <button
                type="button"
                className="linha-btn linha-btn--sm"
                onClick={() => setModo(null)}
              >
                {t('actions.cancel')}
              </button>
              <button
                type="submit"
                className="linha-btn linha-btn--sm linha-btn--primary"
                disabled={salvando || !nome.trim()}
              >
                {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('colunasPopover.criarColuna')}
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
            {t('colunasPopover.novaColuna')}
          </button>
        )}

        <p className="linha-colunas__nota">{t('colunasPopover.nota')}</p>
      </PopoverContent>
    </Popover>
  );
}
