import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/context/AuthContext';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import {
  excluirFuncao,
  getFinanceiroConfig,
  getFuncoes,
  salvarConfig,
  salvarFuncao,
  type FinanceiroConfig,
  type FuncaoFinanceira,
} from '@/store';
import { DiaInicioSelect } from './DiaInicioSelect';
import { avisarErroFinanceiro } from './erros';

/** Runs one write: invalidates the financeiro v2 queries on success, toasts on failure. */
function useEscrita() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return async (fn: () => Promise<unknown>, falha: string, sucesso?: string): Promise<boolean> => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['financeiro-v2'] });
      if (sucesso) toast.success(sucesso);
      return true;
    } catch (e) {
      if (!handleEntitlementMutationError(e, profile?.conta_id ?? null))
        avisarErroFinanceiro(e, falha, qc);
      return false;
    }
  };
}

/** Right sheet with the workspace-level Financeiro settings. Needs `financeiro/editar`. */
export default function ConfigSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('financeV2');
  const config = useQuery({
    queryKey: ['financeiro-v2', 'config'],
    queryFn: getFinanceiroConfig,
    enabled: open,
  });
  const funcoes = useQuery({
    queryKey: ['financeiro-v2', 'funcoes'],
    queryFn: getFuncoes,
    enabled: open,
  });
  const ready = config.isSuccess && funcoes.isSuccess;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('config.title')}</SheetTitle>
          <SheetDescription>{t('config.description')}</SheetDescription>
        </SheetHeader>
        {ready ? (
          <>
            <PeriodoMetaForm config={config.data} />
            <FuncoesSection funcoes={funcoes.data} />
          </>
        ) : config.isError || funcoes.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t('config.loadError')}
          </p>
        ) : (
          <Spinner className="mx-auto" />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PeriodoMetaForm({ config }: { config: FinanceiroConfig | null }) {
  const { t } = useTranslation('financeV2');
  const escrever = useEscrita();
  const diaInicial = config?.periodo_dia ?? 1;
  const metaInicial = String(Math.round(config?.meta_margem ?? 55));
  const [dia, setDia] = useState(diaInicial);
  const [meta, setMeta] = useState(metaInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = dia !== diaInicial || meta !== metaInicial;
  useUnsavedWork(dirty || busy);

  const salvar = async () => {
    const valor = meta.trim() === '' ? NaN : Number(meta);
    if (!Number.isInteger(valor) || valor < 0 || valor > 100) {
      setErro(t('config.metaErro'));
      return;
    }
    setErro(null);
    setBusy(true);
    await escrever(() => salvarConfig(dia, valor), t('config.erroSalvar'), t('config.salvo'));
    setBusy(false);
  };

  return (
    <section className="flex flex-col gap-4" aria-label={t('config.periodoMetaLabel')}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="financeiro-config-dia">{t('config.diaLabel')}</Label>
        <DiaInicioSelect id="financeiro-config-dia" value={dia} onChange={setDia} disabled={busy} />
        <p className="text-xs text-muted-foreground">{t('config.diaHint')}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="financeiro-config-meta">{t('config.metaLabel')}</Label>
        <Input
          id="financeiro-config-meta"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          className="w-28"
          value={meta}
          onChange={(e) => setMeta(e.target.value)}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? 'financeiro-config-meta-erro' : undefined}
          disabled={busy}
        />
        {erro && (
          <p id="financeiro-config-meta-erro" role="alert" className="text-xs text-destructive">
            {erro}
          </p>
        )}
      </div>
      <div>
        <Button onClick={salvar} disabled={busy || !dirty}>
          {t('actions.save')}
        </Button>
      </div>
    </section>
  );
}

function FuncoesSection({ funcoes }: { funcoes: FuncaoFinanceira[] }) {
  const { t } = useTranslation('financeV2');
  const escrever = useEscrita();
  const [nova, setNova] = useState('');
  const [excluir, setExcluir] = useState<FuncaoFinanceira | null>(null);
  const [busy, setBusy] = useState(false);

  const lista = [...funcoes].sort((a, b) => a.ordem - b.ordem || a.id - b.id);

  const run = async (fn: () => Promise<unknown>, falha: string) => {
    setBusy(true);
    const ok = await escrever(fn, falha);
    setBusy(false);
    return ok;
  };

  const adicionar = async () => {
    const nome = nova.trim();
    if (!nome) return;
    const ordem = lista.reduce((max, f) => Math.max(max, f.ordem), 0) + 1;
    if (await run(() => salvarFuncao(null, nome, ordem), t('config.funcoes.erroAdicionar')))
      setNova('');
  };

  // Moves the row at `i` one slot by swapping `ordem` with its neighbour.
  const mover = (i: number, delta: -1 | 1) => {
    const a = lista[i];
    const b = lista[i + delta];
    return run(
      () => Promise.all([salvarFuncao(a.id, a.nome, b.ordem), salvarFuncao(b.id, b.nome, a.ordem)]),
      t('config.funcoes.erroReordenar'),
    );
  };

  return (
    <section className="flex flex-col gap-3" aria-label={t('config.funcoes.title')}>
      <h3 className="text-sm font-semibold">{t('config.funcoes.title')}</h3>
      <ul className="flex flex-col gap-2">
        {lista.map((f, i) => (
          <FuncaoRow
            key={`${f.id}:${f.nome}`}
            funcao={f}
            busy={busy}
            primeira={i === 0}
            ultima={i === lista.length - 1}
            onRename={(nome) =>
              run(() => salvarFuncao(f.id, nome, f.ordem), t('config.funcoes.erroRenomear'))
            }
            onMove={(delta) => mover(i, delta)}
            onDelete={() => setExcluir(f)}
          />
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Input
          aria-label={t('config.funcoes.nova')}
          placeholder={t('config.funcoes.nova')}
          maxLength={60}
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void adicionar();
          }}
          disabled={busy}
        />
        <Button
          variant="outline"
          className="mb-0 shrink-0"
          onClick={adicionar}
          disabled={busy || !nova.trim()}
        >
          <Plus aria-hidden="true" />
          {t('actions.add')}
        </Button>
      </div>

      <AlertDialog open={excluir !== null} onOpenChange={(o) => !o && setExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('config.funcoes.excluirTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('config.funcoes.excluirBody', { nome: excluir ? `"${excluir.nome}"` : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const alvo = excluir;
                setExcluir(null);
                if (alvo) void run(() => excluirFuncao(alvo.id), t('config.funcoes.erroExcluir'));
              }}
            >
              {t('config.funcoes.excluir')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function FuncaoRow({
  funcao,
  busy,
  primeira,
  ultima,
  onRename,
  onMove,
  onDelete,
}: {
  funcao: FuncaoFinanceira;
  busy: boolean;
  primeira: boolean;
  ultima: boolean;
  onRename: (nome: string) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('financeV2');
  const [nome, setNome] = useState(funcao.nome);

  // Rename on blur; an empty or unchanged name is dropped.
  const confirmar = () => {
    const limpo = nome.trim();
    if (!limpo || limpo === funcao.nome) {
      setNome(funcao.nome);
      return;
    }
    onRename(limpo);
  };

  return (
    <li className="flex items-center gap-1">
      <Input
        aria-label={t('config.funcoes.nomeLabel', { nome: funcao.nome })}
        maxLength={60}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        disabled={busy}
      />
      <Button
        variant="ghost"
        size="icon"
        className="mb-0 shrink-0"
        aria-label={t('config.funcoes.subir', { nome: funcao.nome })}
        disabled={busy || primeira}
        onClick={() => onMove(-1)}
      >
        <ArrowUp aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="mb-0 shrink-0"
        aria-label={t('config.funcoes.descer', { nome: funcao.nome })}
        disabled={busy || ultima}
        onClick={() => onMove(1)}
      >
        <ArrowDown aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="mb-0 shrink-0"
        aria-label={t('config.funcoes.excluirNome', { nome: funcao.nome })}
        disabled={busy}
        onClick={onDelete}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </li>
  );
}
