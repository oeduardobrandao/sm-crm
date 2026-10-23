import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, MessageSquare, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import {
  createEquipeConversa,
  getEquipeChatMembers,
  getEquipeConversas,
  sendEquipeMensagem,
  type EquipeChatMember,
  type EquipeConversa,
} from '@/store';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  EquipeConversaAvatar,
  EquipePessoaAvatar,
} from '@/pages/mensagens/components/EquipeShared';
import {
  BRIDGE_MESSAGE_MAX,
  bridgePostToken,
  buildBridgeMessage,
  type BridgePost,
} from './bridgeMessage';

export { buildBridgeMessage };
export type { BridgePost };

const TITULO = 'Levar este post para o chat';
const SUBTITULO = 'A mensagem vai com um link para o post.';
const ERRO_ENVIO = 'Não foi possível enviar. Tente novamente.';

type Destino = { kind: 'grupo'; conversaId: number } | { kind: 'pessoa'; userId: string };

interface DiscutirNoChatProps {
  post: BridgePost;
  /** `popover` on desktop (text button), `sheet` on phones (icon button). */
  variant: 'popover' | 'sheet';
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function DiscutirNoChat({ post, variant }: DiscutirNoChatProps) {
  const [open, setOpen] = useState(false);

  const panel = <DiscutirPanel post={post} open={open} variant={variant} onClose={setOpen} />;

  if (variant === 'sheet') {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label="Discutir no chat"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
          >
            <MessageSquare size={18} aria-hidden="true" />
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" className="flex max-h-[85dvh] flex-col gap-3 p-4">
          <SheetHeader>
            <SheetTitle className="text-base">{TITULO}</SheetTitle>
            <SheetDescription>{SUBTITULO}</SheetDescription>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="mb-0 gap-1.5">
          <MessageSquare aria-hidden="true" />
          Discutir no chat
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-[360px] max-w-[92vw] flex-col gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">{TITULO}</h2>
          <p className="text-xs text-muted-foreground">{SUBTITULO}</p>
        </div>
        {panel}
      </PopoverContent>
    </Popover>
  );
}

function DiscutirPanel({
  post,
  open,
  variant,
  onClose,
}: {
  post: BridgePost;
  open: boolean;
  variant: 'popover' | 'sheet';
  onClose: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [destino, setDestino] = useState<Destino | null>(null);
  const [texto, setTexto] = useState('');

  // Same keys as the /mensagens Equipe tab, so the cache is shared when it is warm.
  const conversas = useQuery({
    queryKey: ['equipe-conversas'],
    queryFn: getEquipeConversas,
    enabled: open,
  });
  const membros = useQuery({
    queryKey: ['equipe-chat-members'],
    queryFn: getEquipeChatMembers,
    enabled: open,
  });

  const currentUserId = user?.id ?? null;
  const grupos = useMemo(
    () => (conversas.data ?? []).filter((c) => c.tipo === 'grupo'),
    [conversas.data],
  );
  const pessoas = useMemo(
    () => (membros.data ?? []).filter((m) => m.user_id !== currentUserId),
    [membros.data, currentUserId],
  );
  const dmDe = (userId: string): EquipeConversa | undefined =>
    (conversas.data ?? []).find((c) => c.tipo === 'dm' && c.dm_user_id === userId);

  const q = normalize(busca.trim());
  const gruposVisiveis = q ? grupos.filter((g) => normalize(g.display_nome).includes(q)) : grupos;
  const pessoasVisiveis = q ? pessoas.filter((m) => normalize(m.nome).includes(q)) : pessoas;

  const destinoNome =
    destino == null
      ? null
      : destino.kind === 'grupo'
        ? (grupos.find((g) => g.conversa_id === destino.conversaId)?.display_nome ?? null)
        : (pessoas.find((m) => m.user_id === destino.userId)?.nome ?? null);

  const send = useMutation({
    mutationFn: async (alvo: Destino) => {
      let conversaId: number;
      if (alvo.kind === 'grupo') {
        conversaId = alvo.conversaId;
      } else {
        conversaId =
          dmDe(alvo.userId)?.conversa_id ?? (await createEquipeConversa('dm', null, [alvo.userId]));
      }
      await sendEquipeMensagem(conversaId, buildBridgeMessage(texto, post));
      return conversaId;
    },
    onSuccess: (conversaId) => {
      qc.invalidateQueries({ queryKey: ['equipe-conversas'] });
      qc.invalidateQueries({ queryKey: ['equipe-mensagens'] });
      toast.success(`Enviado para ${destinoNome ?? 'a conversa'}.`, {
        action: {
          label: 'Abrir conversa',
          onClick: () => navigate(`/mensagens/equipe/${conversaId}`),
        },
      });
      setTexto('');
      setBusca('');
      setDestino(null);
      onClose(false);
    },
    onError: () => {
      // Keep the text and the selection: the user retries with one click.
      toast.error(ERRO_ENVIO);
    },
  });

  // An unsent note or a send in flight must hold the silent deploy swap.
  useUnsavedWork(open && (texto.trim() !== '' || send.isPending));

  const tokenLen = bridgePostToken(post).length + 1;
  const maxTexto = Math.max(0, BRIDGE_MESSAGE_MAX - tokenLen);
  const podeEnviar = destino != null && destinoNome != null && !send.isPending;
  const carregando = (conversas.isLoading || membros.isLoading) && !conversas.data;
  const vazio = gruposVisiveis.length === 0 && pessoasVisiveis.length === 0;

  function cancelar() {
    setTexto('');
    setBusca('');
    setDestino(null);
    onClose(false);
  }

  function enviar() {
    if (!podeEnviar || destino == null) return;
    send.mutate(destino);
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="relative">
        <Search
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar conversa ou pessoa"
          aria-label="Buscar conversa ou pessoa"
          className="w-full rounded-md border border-input bg-background py-2 pl-8 pr-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
        />
      </div>

      <div
        role="listbox"
        aria-label="Conversas e pessoas"
        className="min-h-0 max-h-56 overflow-y-auto rounded-md border border-[var(--border-color)]"
      >
        {carregando && (
          <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
        )}
        {!carregando && vazio && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma conversa ou pessoa encontrada.
          </p>
        )}
        {gruposVisiveis.length > 0 && (
          <Secao titulo="Grupos">
            {gruposVisiveis.map((g) => (
              <Linha
                key={`g-${g.conversa_id}`}
                testId={`discutir-grupo-${g.conversa_id}`}
                selecionado={destino?.kind === 'grupo' && destino.conversaId === g.conversa_id}
                avatar={<EquipeConversaAvatar conversa={g} size={32} />}
                nome={g.display_nome}
                detalhe={`${g.participantes_count} ${g.participantes_count === 1 ? 'pessoa' : 'pessoas'}`}
                onClick={() => setDestino({ kind: 'grupo', conversaId: g.conversa_id })}
              />
            ))}
          </Secao>
        )}
        {pessoasVisiveis.length > 0 && (
          <Secao titulo="Pessoas">
            {pessoasVisiveis.map((m: EquipeChatMember) => (
              <Linha
                key={`p-${m.user_id}`}
                testId={`discutir-pessoa-${m.user_id}`}
                selecionado={destino?.kind === 'pessoa' && destino.userId === m.user_id}
                avatar={
                  <EquipePessoaAvatar
                    nome={m.nome}
                    fotoUrl={m.avatar_url}
                    size={32}
                    fontSize="0.65rem"
                  />
                }
                nome={m.nome}
                onClick={() => setDestino({ kind: 'pessoa', userId: m.user_id })}
              />
            ))}
          </Secao>
        )}
      </div>

      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={maxTexto}
        rows={3}
        aria-label={destinoNome ? `Mensagem para ${destinoNome}` : 'Mensagem'}
        placeholder={destinoNome ? `Mensagem para ${destinoNome}` : 'Mensagem'}
        className={variant === 'sheet' ? 'min-h-[72px]' : 'min-h-[64px]'}
      />

      <div
        className="inline-flex max-w-full items-center gap-1.5 self-start rounded-full border border-[var(--border-color)] bg-[var(--surface-hover)] px-2.5 py-1 text-xs"
        data-testid="discutir-post-chip"
      >
        <FileText size={13} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <span className="truncate">{post.titulo.trim() || 'Post sem título'}</span>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" className="mb-0" onClick={cancelar}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="ink"
          size="sm"
          className="mb-0"
          disabled={!podeEnviar}
          onClick={enviar}
        >
          {destinoNome ? `Enviar para ${destinoNome}` : 'Enviar'}
        </Button>
      </div>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={titulo}>
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </p>
      {children}
    </div>
  );
}

function Linha({
  testId,
  selecionado,
  avatar,
  nome,
  detalhe,
  onClick,
}: {
  testId: string;
  selecionado: boolean;
  avatar: ReactNode;
  nome: string;
  detalhe?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selecionado}
      data-testid={testId}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--surface-hover)]"
      style={selecionado ? { background: 'var(--surface-hover)' } : undefined}
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{nome}</span>
        {detalhe && <span className="block text-xs text-muted-foreground">{detalhe}</span>}
      </span>
      {selecionado && <Check size={16} aria-hidden="true" className="shrink-0" />}
    </button>
  );
}
