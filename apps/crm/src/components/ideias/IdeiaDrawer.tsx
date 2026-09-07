import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Save, Loader2, ImagePlus, ListChecks, X } from 'lucide-react';
import {
  listIdeiaImages,
  uploadIdeiaImage,
  removeIdeiaImage,
  type CrmIdeiaImage,
} from '@/services/ideiaMedia';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { IdeiaStatusBadge } from './IdeiaStatusBadge';
import { IdeiaTipoBadge } from './IdeiaTipoBadge';
import {
  updateIdeiaStatus,
  upsertIdeiaComentario,
  toggleIdeiaReaction,
  getMembros,
  getClientes,
  getTarefaTags,
  setTarefaTags,
  convertSolicitacaoEmTarefa,
  type Ideia,
} from '@/store';
import {
  TarefaFormDialog,
  type TarefaFormPayload,
} from '@/pages/tarefas/components/TarefaFormDialog';
import { useAuth } from '@/context/AuthContext';
import { sanitizeExternalUrl, sanitizeUrl } from '@/utils/security';

const ALLOWED_EMOJI = ['👍', '❤️', '🔥', '💡', '🎯'] as const;

const STATUS_OPTIONS: { value: Ideia['status']; label: string }[] = [
  { value: 'nova', label: 'Nova' },
  { value: 'em_analise', label: 'Em análise' },
  { value: 'aprovada', label: 'Aprovada' },
  { value: 'descartada', label: 'Descartada' },
];

const CONVERSIBLE_STATUSES: Ideia['status'][] = ['nova', 'em_analise', 'aprovada'];

interface IdeiaDrawerProps {
  ideia: Ideia;
  queryKey: unknown[];
  onClose: () => void;
}

export function IdeiaDrawer({ ideia, queryKey, onClose }: IdeiaDrawerProps) {
  const qc = useQueryClient();
  const { profile, can } = useAuth();
  // IdeiasPage/IdeiaDrawer had NO role check at all before Task 14 -- any
  // authenticated member could add or remove an idea's reference images.
  // AGENT_ROLE_PRESET.ideias is 'editar' (lib/permissions.ts), so this
  // preserves full access for every legacy chassis role byte-for-byte; only
  // a CUSTOM role (role_id set) can now differ from full access.
  const canEditIdeias = can('ideias', 'editar') === true;

  const { data: membros = [] } = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
  });
  const membroId: number | undefined = membros.find((m: any) => m.user_id === profile?.id)?.id;

  const [convertOpen, setConvertOpen] = useState(false);
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const { data: tarefaTags = [] } = useQuery({ queryKey: ['tarefa-tags'], queryFn: getTarefaTags });

  const isConverted = ideia.status === 'convertida' || ideia.status === 'concluida';
  const statusLocked = isConverted && ideia.tarefa_id != null;
  const canConvert = ideia.tipo === 'solicitacao' && CONVERSIBLE_STATUSES.includes(ideia.status);

  async function handleConvertCreate(payload: TarefaFormPayload, tagIds: number[]) {
    // A RPC e o commit da conversao; tags sao best-effort depois dela.
    const tarefaId = await convertSolicitacaoEmTarefa({
      ideiaId: ideia.id,
      titulo: payload.titulo,
      descricao: payload.descricao,
      responsavelId: payload.responsavel_id,
      dataLimite: payload.data_limite,
    });
    let tagsOk = true;
    if (tagIds.length > 0) {
      try {
        await setTarefaTags(tarefaId, tagIds);
      } catch {
        tagsOk = false;
      }
    }
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ['tarefas'] });
    if (tagsOk) toast.success('Solicitação convertida em tarefa!');
    else
      toast.warning(
        'Tarefa criada, mas as tags não foram aplicadas. Edite a tarefa para adicioná-las.',
      );
  }

  const MAX_IMAGES = 10;
  const inputRef = useRef<HTMLInputElement>(null);
  const [imgBusy, setImgBusy] = useState(false);

  const { data: images = [] } = useQuery({
    queryKey: ['ideia-images', ideia.id],
    queryFn: () => listIdeiaImages(ideia.id),
  });

  async function handleImageFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImgBusy(true);
    const slots = MAX_IMAGES - images.length;
    const chosen = Array.from(files).slice(0, slots);
    try {
      for (let i = 0; i < chosen.length; i++) {
        await uploadIdeiaImage(ideia.id, chosen[i], images.length + i);
      }
      qc.invalidateQueries({ queryKey: ['ideia-images', ideia.id] });
      qc.invalidateQueries({ queryKey });
      toast.success('Imagem adicionada.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao enviar imagem.');
    } finally {
      setImgBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemoveImage(fileId: number) {
    setImgBusy(true);
    try {
      await removeIdeiaImage(ideia.id, fileId);
      qc.invalidateQueries({ queryKey: ['ideia-images', ideia.id] });
      qc.invalidateQueries({ queryKey });
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao remover imagem.');
    } finally {
      setImgBusy(false);
    }
  }

  const [statusSaving, setStatusSaving] = useState(false);
  const [comentario, setComentario] = useState(ideia.comentario_agencia ?? '');
  const [comentarioSaving, setComentarioSaving] = useState(false);
  const [reactionLoading, setReactionLoading] = useState<string | null>(null);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  async function handleStatusChange(newStatus: Ideia['status']) {
    setStatusSaving(true);
    try {
      await updateIdeiaStatus(ideia.id, newStatus);
      qc.invalidateQueries({ queryKey });
      toast.success('Status atualizado.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao atualizar status.');
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleSaveComentario() {
    if (!membroId) return;
    setComentarioSaving(true);
    try {
      await upsertIdeiaComentario(ideia.id, comentario, membroId);
      qc.invalidateQueries({ queryKey });
      toast.success('Comentário salvo.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao salvar comentário.');
    } finally {
      setComentarioSaving(false);
    }
  }

  async function handleReaction(emoji: string) {
    if (!membroId) return;
    setReactionLoading(emoji);
    try {
      await toggleIdeiaReaction(ideia.id, membroId, emoji);
      qc.invalidateQueries({ queryKey });
    } catch (e: any) {
      toast.error(e.message ?? 'Erro.');
    } finally {
      setReactionLoading(null);
    }
  }

  const reactionMap = new Map<string, { count: number; names: string[]; myReaction: boolean }>();
  for (const r of ideia.ideia_reactions) {
    const entry = reactionMap.get(r.emoji) ?? { count: 0, names: [], myReaction: false };
    entry.count++;
    entry.names.push(r.membros.nome);
    if (r.membro_id === membroId) entry.myReaction = true;
    reactionMap.set(r.emoji, entry);
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0 gap-0">
        <SheetHeader className="px-6 py-5 border-b border-border space-y-1.5">
          <div className="mb-1.5 flex gap-1.5">
            <IdeiaStatusBadge status={ideia.status} />
            <IdeiaTipoBadge tipo={ideia.tipo} />
          </div>
          <SheetTitle className="text-base leading-snug">{ideia.titulo}</SheetTitle>
          <SheetDescription className="text-xs">
            {ideia.clientes.nome} · {formatDate(ideia.created_at)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Descrição</p>
            <p className="text-sm whitespace-pre-wrap">{ideia.descricao}</p>
          </div>

          {ideia.links.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">
                Links de referência
              </p>
              <div className="space-y-1">
                {ideia.links.map((link, i) => (
                  <a
                    key={i}
                    href={sanitizeUrl(link)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                  >
                    <ExternalLink size={12} />
                    {link.length > 55 ? link.slice(0, 55) + '…' : link}
                  </a>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Imagens</p>
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {images.map((img: CrmIdeiaImage) => (
                  <div key={img.file_id} className="relative group">
                    <a
                      href={sanitizeExternalUrl(img.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img
                        src={img.thumbnail_url ?? img.url}
                        alt=""
                        className="h-16 w-16 rounded-md object-cover border border-border bg-muted"
                      />
                    </a>
                    {canEditIdeias && (
                      <button
                        onClick={() => handleRemoveImage(img.file_id)}
                        disabled={imgBusy}
                        aria-label="Remover imagem"
                        className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-foreground text-background opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canEditIdeias && images.length < MAX_IMAGES && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={imgBusy}
                onClick={() => inputRef.current?.click()}
              >
                {imgBusy ? (
                  <Loader2 size={13} className="animate-spin mr-1.5" />
                ) : (
                  <ImagePlus size={13} className="mr-1.5" />
                )}
                Adicionar imagem
              </Button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => handleImageFiles(e.target.files)}
            />
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Status</p>
            {statusLocked ? (
              <div className="flex items-center gap-3">
                <IdeiaStatusBadge status={ideia.status} />
                <Link
                  to={`/tarefas?tarefa=${ideia.tarefa_id}`}
                  className="inline-flex items-center gap-1.5 text-sm underline underline-offset-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ListChecks size={14} />
                  Ver tarefa
                </Link>
              </div>
            ) : (
              <Select
                value={
                  CONVERSIBLE_STATUSES.includes(ideia.status) || ideia.status === 'descartada'
                    ? ideia.status
                    : undefined
                }
                onValueChange={(v) => handleStatusChange(v as Ideia['status'])}
                disabled={statusSaving}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Selecionar status..." />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {canConvert && (
              <Button size="sm" className="mt-3" onClick={() => setConvertOpen(true)}>
                <ListChecks size={13} className="mr-1.5" />
                Converter em tarefa
              </Button>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Reações</p>
            <div className="flex flex-wrap gap-2">
              {ALLOWED_EMOJI.map((emoji) => {
                const entry = reactionMap.get(emoji);
                const active = entry?.myReaction ?? false;
                return (
                  <Button
                    key={emoji}
                    type="button"
                    variant={active ? 'ink' : 'outline'}
                    size="sm"
                    onClick={() => handleReaction(emoji)}
                    disabled={reactionLoading === emoji}
                    title={entry?.names.join(', ') ?? ''}
                    className="rounded-full gap-1.5"
                  >
                    {reactionLoading === emoji ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      emoji
                    )}
                    {entry && <span className="font-medium text-[12px]">{entry.count}</span>}
                  </Button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">
              Resposta da agência
              {ideia.comentario_at && (
                <span className="ml-1.5 normal-case tracking-normal text-muted-foreground/70 font-normal">
                  — editado em {formatDate(ideia.comentario_at)}
                  {ideia.comentario_autor && ` por ${ideia.comentario_autor.nome}`}
                </span>
              )}
            </p>
            <Textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Escreva uma resposta para o cliente..."
              className="min-h-[90px] resize-none rounded-[8px]"
            />
            <Button
              size="sm"
              variant="ink"
              className="mt-2"
              onClick={handleSaveComentario}
              disabled={comentarioSaving}
            >
              {comentarioSaving && <Loader2 size={13} className="animate-spin mr-1.5" />}
              <Save size={13} className="mr-1.5" />
              Salvar comentário
            </Button>
          </div>
        </div>
      </SheetContent>

      <TarefaFormDialog
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        editing={null}
        membros={membros}
        clientes={clientes}
        tags={tarefaTags}
        onSaved={() => {}}
        onTagCreated={() => qc.invalidateQueries({ queryKey: ['tarefa-tags'] })}
        initialValues={{
          titulo: ideia.titulo,
          descricao: ideia.descricao,
          cliente_id: ideia.cliente_id,
        }}
        lockCliente
        onCreate={handleConvertCreate}
      />
    </Sheet>
  );
}
