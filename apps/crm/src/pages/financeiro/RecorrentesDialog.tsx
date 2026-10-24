import { useState } from 'react';
import { toast } from 'sonner';
import { Edit2, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import { removeRecorrente, updateRecorrente, type TransacaoRecorrente } from '../../store';

/** First day of the month `offset` months from today, as YYYY-MM-01. */
export function primeiroDoMes(offset = 0): string {
  const d = new Date();
  const alvo = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Still occurs this month or later. */
export function recorrenteAtiva(r: TransacaoRecorrente): boolean {
  return !r.fim || r.fim >= primeiroDoMes();
}

interface RecorrentesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recorrentes: TransacaoRecorrente[];
  categorias: string[];
  access: FinancialAccess;
  /** Refetch after a change. */
  onChanged: () => void;
}

interface Edicao {
  id: number;
  descricao: string;
  valor: string;
  dia: string;
  categoria: string;
}

/**
 * The workspace's recurring lançamentos: each shows up every month as an "agendado" entry.
 * Editing changes this month's pending entry and the next ones; stopping removes them from
 * this month on, and the entries already confirmed stay.
 */
export function RecorrentesDialog({
  open,
  onOpenChange,
  recorrentes,
  categorias,
  access,
  onChanged,
}: RecorrentesDialogProps) {
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [encerrar, setEncerrar] = useState<TransacaoRecorrente | null>(null);
  const [salvando, setSalvando] = useState(false);
  const editar = (patch: Partial<Edicao>) => setEdicao((e) => (e ? { ...e, ...patch } : e));
  const ativas = recorrentes.filter(recorrenteAtiva);

  const valorEdicao = Number(edicao?.valor.replace(',', '.'));
  const diaEdicao = Number(edicao?.dia);
  const edicaoValida =
    !!edicao &&
    edicao.descricao.trim().length > 0 &&
    valorEdicao > 0 &&
    Number.isInteger(diaEdicao) &&
    diaEdicao >= 1 &&
    diaEdicao <= 31;

  const salvarEdicao = async () => {
    if (!edicao || !edicaoValida || salvando) return;
    setSalvando(true);
    try {
      await updateRecorrente(edicao.id, {
        descricao: edicao.descricao.trim(),
        valor: valorEdicao,
        dia: diaEdicao,
        categoria: edicao.categoria,
      });
      toast.success('Lançamento recorrente atualizado');
      setEdicao(null);
      onChanged();
    } catch {
      toast.error('Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  const confirmarEncerrar = async () => {
    if (!encerrar?.id) return;
    const mesPassado = primeiroDoMes(-1);
    try {
      // Started this month: there is no earlier month to end on, so it goes away. The
      // entries already confirmed are plain lançamentos and stay either way.
      if (encerrar.inicio > mesPassado) await removeRecorrente(encerrar.id);
      else await updateRecorrente(encerrar.id, { fim: mesPassado });
      toast.success('Lançamento recorrente encerrado');
      onChanged();
    } catch {
      toast.error('Erro ao encerrar');
    }
    setEncerrar(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setEdicao(null);
          setEncerrar(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Lançamentos recorrentes</DialogTitle>
          <DialogDescription>
            Aparecem todo mês como agendados, no dia escolhido, para você confirmar.
          </DialogDescription>
        </DialogHeader>

        {ativas.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Nenhum lançamento recorrente. Ao registrar uma entrada ou saída, marque &quot;Repetir
            todo mês&quot;.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {ativas.map((r) =>
              edicao && edicao.id === r.id ? (
                <li key={r.id} className="flex flex-col gap-3 py-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`rec-desc-${r.id}`}>Descrição</Label>
                    <Input
                      id={`rec-desc-${r.id}`}
                      value={edicao.descricao}
                      onChange={(e) => editar({ descricao: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`rec-valor-${r.id}`}>Valor (R$)</Label>
                      <Input
                        id={`rec-valor-${r.id}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={0.01}
                        value={edicao.valor}
                        onChange={(e) => editar({ valor: e.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`rec-dia-${r.id}`}>Dia do mês</Label>
                      <Input
                        id={`rec-dia-${r.id}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={31}
                        value={edicao.dia}
                        onChange={(e) => editar({ dia: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Categoria</Label>
                    <Select
                      value={edicao.categoria}
                      onValueChange={(v) => editar({ categoria: v })}
                    >
                      <SelectTrigger aria-label="Categoria">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {categorias.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setEdicao(null)}>
                      Cancelar
                    </Button>
                    <Button onClick={salvarEdicao} disabled={!edicaoValida || salvando}>
                      {salvando && <Spinner size="sm" />}
                      Salvar
                    </Button>
                  </div>
                </li>
              ) : encerrar?.id === r.id ? (
                // Inline, not a second dialog stacked over this one.
                <li
                  key={r.id}
                  role="group"
                  aria-label={`Encerrar ${r.descricao}`}
                  className="flex flex-col gap-2 py-3"
                >
                  <span className="text-sm font-semibold">Encerrar &quot;{r.descricao}&quot;?</span>
                  <span className="text-xs text-muted-foreground">
                    Ele deixa de aparecer a partir deste mês. Os lançamentos já confirmados
                    continuam.
                  </span>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEncerrar(null)}>
                      Não
                    </Button>
                    <Button size="sm" variant="destructive" onClick={confirmarEncerrar}>
                      Encerrar
                    </Button>
                  </div>
                </li>
              ) : (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <Repeat className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="break-words text-sm font-semibold">{r.descricao}</span>
                    <span className="text-xs text-muted-foreground">
                      Todo dia {r.dia}
                      {r.categoria ? ` · ${r.categoria}` : ''}
                    </span>
                  </div>
                  <span
                    className="whitespace-nowrap text-sm font-semibold tabular-nums"
                    style={{ color: r.tipo === 'entrada' ? '#3ecf8e' : '#ef4444' }}
                  >
                    {r.tipo === 'entrada' ? '+' : '-'}
                    {formatFinancialBRL(r.valor, access)}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Editar ${r.descricao}`}
                    onClick={() =>
                      setEdicao({
                        id: r.id!,
                        descricao: r.descricao,
                        valor: String(r.valor),
                        dia: String(r.dia),
                        categoria: r.categoria,
                      })
                    }
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEncerrar(r)}>
                    Encerrar
                  </Button>
                </li>
              ),
            )}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default RecorrentesDialog;
