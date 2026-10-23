import { useEffect, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Upload } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/context/AuthContext';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import { cn } from '@/lib/utils';
import {
  getFuncoes,
  getPeriodosEditaveis,
  salvarAcordo,
  uploadContratoAcordo,
  validarContratoAcordo,
  type AcordoInput,
  type AcordoVersao,
  type Membro,
  type ModeloAcordo,
} from '@/store';
import { PeriodoSelect } from '../financeiro/v2/PeriodoSelect';
import {
  contratoRotulo,
  metaPorMes,
  MODELO_DESCRICAO,
  MODELO_LABEL,
  PERIODO_OPCOES,
  UNIDADES,
} from './acordoHelpers';
import { avisarErroFinanceiro } from '../financeiro/v2/erros';
import { periodoPadrao } from '../financeiro/v2/periodos';

const MODELOS: ModeloAcordo[] = ['mensal_meta', 'mensal_limite', 'por_entrega'];
const SEM_FUNCAO = '__none__';

const inteiroPositivo = (v: string) => /^\d+$/.test(v.trim()) && Number(v) > 0;

const acordoSchema = z
  .object({
    modelo: z.enum(['mensal_meta', 'mensal_limite', 'por_entrega']),
    funcaoId: z.string(),
    valor: z.string(),
    diaPag: z.string(),
    metaQtd: z.string(),
    unidade: z.string(),
    metaPeriodo: z.enum(['dia_util', 'semana', 'mes']),
    limite: z.string(),
    vigIni: z.string(),
    vigFim: z.string(),
    valeDesde: z.string().min(1, 'Escolha o período.'),
    // Object path of the signed contract in the private bucket; '' = none.
    arquivoPath: z.string(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    const valor = v.valor.trim() === '' ? NaN : Number(v.valor);
    if (!Number.isFinite(valor) || valor < 0) {
      issue('valor', 'Informe um valor maior ou igual a zero.');
    }
    if (
      v.diaPag !== '' &&
      !(/^\d+$/.test(v.diaPag) && Number(v.diaPag) >= 1 && Number(v.diaPag) <= 31)
    ) {
      issue('diaPag', 'Dia deve ser entre 1 e 31');
    }
    if (v.modelo === 'mensal_meta' && !inteiroPositivo(v.metaQtd)) {
      issue('metaQtd', 'Informe uma meta maior que zero.');
    }
    if (v.modelo === 'mensal_limite' && !inteiroPositivo(v.limite)) {
      issue('limite', 'Informe um limite maior que zero.');
    }
    if (v.vigIni && v.vigFim && v.vigFim < v.vigIni) {
      issue('vigFim', 'O fim não pode ser antes do início.');
    }
  });

type AcordoFormValues = z.infer<typeof acordoSchema>;

function defaultsFor(
  membro: Membro,
  atual: AcordoVersao | undefined,
  valeDesde: string,
): AcordoFormValues {
  if (atual) {
    return {
      modelo: atual.modelo,
      funcaoId: atual.funcao_id == null ? SEM_FUNCAO : String(atual.funcao_id),
      valor: String(atual.valor),
      diaPag: atual.dia_pagamento == null ? '' : String(atual.dia_pagamento),
      metaQtd: atual.meta_quantidade == null ? '' : String(atual.meta_quantidade),
      unidade: atual.unidade ?? UNIDADES[0],
      metaPeriodo: atual.meta_periodo ?? 'dia_util',
      limite: atual.limite_clientes == null ? '' : String(atual.limite_clientes),
      vigIni: atual.vigencia_inicio ?? '',
      vigFim: atual.vigencia_fim ?? '',
      valeDesde,
      arquivoPath: atual.arquivo_path ?? '',
    };
  }
  // No acordo yet: start from the member's legacy cost and payment day.
  return {
    modelo: 'mensal_meta',
    funcaoId: SEM_FUNCAO,
    valor: String(membro.custo_mensal ?? 0),
    diaPag: membro.data_pagamento == null ? '' : String(membro.data_pagamento),
    metaQtd: '',
    unidade: UNIDADES[0],
    metaPeriodo: 'dia_util',
    limite: '',
    vigIni: '',
    vigFim: '',
    valeDesde,
    arquivoPath: '',
  };
}

interface AcordoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membro: Membro;
  /** The version in force now; undefined when the member has no acordo yet. */
  atual: AcordoVersao | undefined;
}

/** Creates a new version of the member's acordo ("Vale a partir de" a chosen period). */
export function AcordoDialog({ open, onOpenChange, membro, atual }: AcordoDialogProps) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const funcoes = useQuery({
    queryKey: ['financeiro-v2', 'funcoes'],
    queryFn: getFuncoes,
    enabled: open,
  });
  const editaveis = useQuery({
    queryKey: ['financeiro-v2', 'editaveis'],
    queryFn: getPeriodosEditaveis,
    enabled: open,
  });
  const periodos = editaveis.data ?? [];
  const valeDesdePadrao = periodoPadrao(periodos)?.inicio ?? '';

  const form = useForm<AcordoFormValues>({
    resolver: zodResolver(acordoSchema),
    defaultValues: defaultsFor(membro, atual, valeDesdePadrao),
  });
  const modelo = useWatch({ control: form.control, name: 'modelo' });
  const metaQtd = useWatch({ control: form.control, name: 'metaQtd' });
  const metaPeriodo = useWatch({ control: form.control, name: 'metaPeriodo' });
  const unidadeAtual = useWatch({ control: form.control, name: 'unidade' });
  const arquivoPath = useWatch({ control: form.control, name: 'arquivoPath' });
  const { errors, isDirty } = form.formState;

  useEffect(() => {
    if (open) {
      form.reset(defaultsFor(membro, atual, valeDesdePadrao));
      setErroArquivo(null);
    }
  }, [form, open, membro, atual, valeDesdePadrao]);

  // The unit is free text in the database: keep a stored value outside the four presets.
  const unidades: string[] = UNIDADES.includes(unidadeAtual as (typeof UNIDADES)[number])
    ? [...UNIDADES]
    : [...UNIDADES, unidadeAtual];

  const metaMensal =
    modelo === 'mensal_meta' && metaPeriodo !== 'mes' && inteiroPositivo(metaQtd)
      ? metaPorMes(Number(metaQtd), metaPeriodo)
      : null;

  const escolherArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Lets the same file be picked again after a rejection.
    e.target.value = '';
    if (!file || uploading) return;
    const invalido = validarContratoAcordo(file);
    setErroArquivo(invalido);
    if (invalido) return;
    setUploading(true);
    try {
      const path = await uploadContratoAcordo(membro.id as number, file);
      form.setValue('arquivoPath', path, { shouldDirty: true });
    } catch (err) {
      // The previous path stays in the form.
      if (!handleEntitlementMutationError(err, profile?.conta_id ?? null)) {
        toast.error('Não foi possível enviar o arquivo. Tente novamente.');
      }
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (v: AcordoFormValues) => {
    if (uploading || saving) return;
    const input: AcordoInput = {
      funcao_id: v.funcaoId === SEM_FUNCAO ? null : Number(v.funcaoId),
      modelo: v.modelo,
      valor: Number(v.valor),
      unidade: v.modelo === 'mensal_meta' ? v.unidade : null,
      meta_quantidade: v.modelo === 'mensal_meta' ? Number(v.metaQtd) : null,
      meta_periodo: v.modelo === 'mensal_meta' ? v.metaPeriodo : null,
      limite_clientes: v.modelo === 'mensal_limite' ? Number(v.limite) : null,
      dia_pagamento: v.diaPag === '' ? null : Number(v.diaPag),
      vigencia_inicio: v.vigIni || null,
      vigencia_fim: v.vigFim || null,
      arquivo_path: v.arquivoPath || null,
    };
    setSaving(true);
    try {
      await salvarAcordo(membro.id as number, v.valeDesde, input);
      await qc.invalidateQueries({ queryKey: ['financeiro-v2'] });
      await qc.invalidateQueries({ queryKey: ['membros'] });
      toast.success('Acordo salvo.');
      onOpenChange(false);
    } catch (e) {
      if (!handleEntitlementMutationError(e, profile?.conta_id ?? null)) {
        avisarErroFinanceiro(e, 'Erro ao salvar o acordo', qc);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent confirmClose={isDirty} onConfirmClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{atual ? 'Editar acordo' : 'Cadastrar acordo'}</DialogTitle>
          <DialogDescription>
            Defina como essa pessoa é paga e a partir de quando isso vale.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div role="group" aria-labelledby="acordo-modelo-titulo" className="space-y-2">
              <p id="acordo-modelo-titulo" className="text-sm font-medium">
                Como essa pessoa é paga?
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {MODELOS.map((m) => {
                  const selecionado = modelo === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={selecionado}
                      onClick={() => form.setValue('modelo', m, { shouldDirty: true })}
                      className={cn(
                        'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors',
                        selecionado
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:bg-muted',
                      )}
                    >
                      <span className="text-sm font-semibold">{MODELO_LABEL[m]}</span>
                      <span className="text-xs text-muted-foreground">{MODELO_DESCRICAO[m]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <FormField
              control={form.control}
              name="funcaoId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Função</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={SEM_FUNCAO}>Sem função</SelectItem>
                      {(funcoes.data ?? []).map((f) => (
                        <SelectItem key={f.id} value={String(f.id)}>
                          {f.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="valor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {modelo === 'por_entrega' ? 'Valor por entrega' : 'Valor mensal'}
                    </FormLabel>
                    <FormControl>
                      <Input type="number" inputMode="decimal" min={0} step={0.01} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="diaPag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dia de pagamento</FormLabel>
                    <FormControl>
                      <Input type="number" inputMode="numeric" min={1} max={31} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {modelo === 'mensal_meta' && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <FormField
                    control={form.control}
                    name="metaQtd"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Quantidade da meta</FormLabel>
                        <FormControl>
                          <Input type="number" inputMode="numeric" min={1} step={1} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="unidade"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Unidade</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {unidades.map((u) => (
                              <SelectItem key={u} value={u}>
                                {u}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="metaPeriodo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Período da meta</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {PERIODO_OPCOES.map((p) => (
                              <SelectItem key={p.value} value={p.value}>
                                {p.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </div>
                {errors.metaQtd && (
                  <p role="alert" className="text-sm font-medium text-destructive">
                    {errors.metaQtd.message}
                  </p>
                )}
                {metaMensal !== null && (
                  <p className="text-xs text-muted-foreground">Cerca de {metaMensal} por mês</p>
                )}
              </div>
            )}

            {modelo === 'mensal_limite' && (
              <FormField
                control={form.control}
                name="limite"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Limite de clientes</FormLabel>
                    <FormControl>
                      <Input type="number" inputMode="numeric" min={1} step={1} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="vigIni"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Início da vigência</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="vigFim"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fim da vigência</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-2">
              <p id="acordo-contrato-titulo" className="text-sm font-medium">
                Contrato assinado
              </p>
              <div
                role="group"
                aria-labelledby="acordo-contrato-titulo"
                className="flex flex-wrap items-center gap-3"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className={arquivoPath ? 'font-medium' : 'text-muted-foreground'}>
                    {arquivoPath ? contratoRotulo(arquivoPath) : 'Nenhum arquivo'}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => inputArquivo.current?.click()}
                >
                  {uploading ? (
                    <Spinner size="sm" />
                  ) : (
                    <Upload className="h-4 w-4" aria-hidden="true" />
                  )}
                  {arquivoPath ? 'Trocar arquivo' : 'Enviar arquivo'}
                </Button>
                <input
                  ref={inputArquivo}
                  type="file"
                  hidden
                  aria-label="Arquivo do contrato"
                  accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
                  onChange={escolherArquivo}
                />
              </div>
              {uploading && (
                <p role="status" className="text-xs text-muted-foreground">
                  Enviando arquivo...
                </p>
              )}
              {erroArquivo && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {erroArquivo}
                </p>
              )}
              <p className="text-xs text-muted-foreground">PDF, PNG ou JPG de até 10 MB.</p>
            </div>

            <FormField
              control={form.control}
              name="valeDesde"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vale a partir de</FormLabel>
                  {/* Mounted once the periods and the default are in: a Select cannot go from unset to controlled. */}
                  {periodos.length > 0 && field.value ? (
                    <FormControl>
                      <PeriodoSelect
                        value={field.value}
                        onChange={field.onChange}
                        periodos={periodos}
                        ordem="cronologica"
                        className="sm:w-full"
                      />
                    </FormControl>
                  ) : (
                    <Skeleton className="h-9 w-full" />
                  )}
                  <FormDescription>
                    O acordo vale desde o início do período escolhido.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || uploading}>
                {saving && <Spinner size="sm" />} Salvar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default AcordoDialog;
