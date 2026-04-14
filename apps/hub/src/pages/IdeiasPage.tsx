import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, ExternalLink, X, Loader2 } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchIdeias, createIdeia, updateIdeia, deleteIdeia } from '../api';
import type { HubIdeia } from '../types';

const ALLOWED_EMOJI = ['👍', '❤️', '🔥', '💡', '🎯'] as const;

const STATUS_LABEL: Record<HubIdeia['status'], string> = {
  nova: 'Nova',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  descartada: 'Descartada',
};

const STATUS_COLOR: Record<HubIdeia['status'], string> = {
  nova: 'bg-stone-100 text-stone-600',
  em_analise: 'bg-yellow-100 text-yellow-700',
  aprovada: 'bg-green-100 text-green-700',
  descartada: 'bg-red-100 text-red-600',
};

function isMutable(ideia: HubIdeia): boolean {
  return (
    ideia.status === 'nova' &&
    ideia.comentario_agencia === null &&
    ideia.ideia_reactions.length === 0
  );
}

function sanitizeUrl(href: string): string {
  try {
    const url = new URL(href);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch { /* fall through */ }
  return '#';
}

export function IdeiasPage() {
  const { token } = useHub();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<HubIdeia | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['hub-ideias', token],
    queryFn: () => fetchIdeias(token),
  });

  const ideias = data?.ideias ?? [];

  function openCreate() { setEditing(null); setModalOpen(true); }
  function openEdit(ideia: HubIdeia) { setEditing(ideia); setModalOpen(true); }

  return (
    <div className="hub-fade-up">
      {/* Hero */}
      <div className="mb-8 sm:mb-10 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-2">Ideias</p>
          <h1 className="font-display text-[2rem] sm:text-[2.5rem] leading-[1.05] font-medium tracking-tight text-stone-900">
            Compartilhe suas ideias
          </h1>
          <p className="text-sm text-stone-500 mt-2">Envie sugestões e a agência responderá em breve.</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 shrink-0 px-4 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 transition-colors"
        >
          <Plus size={16} strokeWidth={2.5} />
          Nova ideia
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      ) : ideias.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <span className="text-5xl mb-4">💡</span>
          <p className="font-display text-lg font-semibold text-stone-800 mb-1">Nenhuma ideia ainda</p>
          <p className="text-sm text-stone-500 mb-6">Clique em "Nova ideia" para compartilhar sua primeira sugestão.</p>
          <button
            onClick={openCreate}
            className="px-4 py-2 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 transition-colors"
          >
            Adicionar ideia
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {ideias.map(ideia => (
            <IdeiaCard
              key={ideia.id}
              ideia={ideia}
              onEdit={() => openEdit(ideia)}
              onDelete={() => {
                deleteIdeia(token, ideia.id)
                  .then(() => qc.invalidateQueries({ queryKey: ['hub-ideias', token] }))
                  .catch(err => alert(err.message));
              }}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <IdeiaModal
          token={token}
          editing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['hub-ideias', token] });
            setModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

function IdeiaCard({ ideia, onEdit, onDelete }: { ideia: HubIdeia; onEdit: () => void; onDelete: () => void }) {
  const mutable = isMutable(ideia);

  // Group reactions by emoji
  const reactionMap = new Map<string, string[]>();
  for (const r of ideia.ideia_reactions) {
    const names = reactionMap.get(r.emoji) ?? [];
    names.push(r.membros.nome);
    reactionMap.set(r.emoji, names);
  }

  return (
    <div className="hub-card p-5 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full mb-2 ${STATUS_COLOR[ideia.status]}`}>
            {STATUS_LABEL[ideia.status]}
          </span>
          <h3 className="font-display text-[17px] font-semibold text-stone-900 leading-snug">{ideia.titulo}</h3>
          <p className="text-sm text-stone-600 mt-1 whitespace-pre-wrap">{ideia.descricao}</p>
        </div>
        {mutable && (
          <div className="flex gap-1 shrink-0">
            <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-500 hover:text-stone-800 transition-colors">
              <Pencil size={15} />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-stone-500 hover:text-red-600 transition-colors">
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Links */}
      {ideia.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {ideia.links.map((link, i) => (
            <a
              key={i}
              href={sanitizeUrl(link)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-800 underline underline-offset-2 transition-colors"
            >
              <ExternalLink size={11} />
              {link.length > 50 ? link.slice(0, 50) + '…' : link}
            </a>
          ))}
        </div>
      )}

      {/* Reactions */}
      {reactionMap.size > 0 && (
        <div className="flex flex-wrap gap-2">
          {[...reactionMap.entries()].map(([emoji, names]) => (
            <span
              key={emoji}
              title={names.join(', ')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-100 text-sm"
            >
              {emoji} <span className="text-[12px] text-stone-600 font-medium">{names.length}</span>
            </span>
          ))}
        </div>
      )}

      {/* Agency comment */}
      {ideia.comentario_agencia && (
        <div className="border-t border-stone-100 pt-3 mt-1">
          <p className="text-[11px] uppercase tracking-wide text-stone-400 font-medium mb-1">
            Resposta da agência
            {ideia.comentario_autor && <span className="normal-case tracking-normal ml-1">— {ideia.comentario_autor.nome}</span>}
          </p>
          <p className="text-sm text-stone-700 whitespace-pre-wrap">{ideia.comentario_agencia}</p>
        </div>
      )}
    </div>
  );
}

interface ModalProps {
  token: string;
  editing: HubIdeia | null;
  onClose: () => void;
  onSaved: () => void;
}

function IdeiaModal({ token, editing, onClose, onSaved }: ModalProps) {
  const [titulo, setTitulo] = useState(editing?.titulo ?? '');
  const [descricao, setDescricao] = useState(editing?.descricao ?? '');
  const [links, setLinks] = useState<string[]>(editing?.links.length ? editing.links : ['']);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ titulo?: string; descricao?: string }>({});

  function validate() {
    const e: typeof errors = {};
    if (!titulo.trim()) e.titulo = 'Título obrigatório';
    if (!descricao.trim()) e.descricao = 'Descrição obrigatória';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    const cleanLinks = links.map(l => l.trim()).filter(Boolean);
    try {
      if (editing) {
        await updateIdeia(token, editing.id, { titulo: titulo.trim(), descricao: descricao.trim(), links: cleanLinks });
      } else {
        await createIdeia(token, { titulo: titulo.trim(), descricao: descricao.trim(), links: cleanLinks });
      }
      onSaved();
    } catch (err: unknown) {
      alert((err as Error).message ?? 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-stone-900">
            {editing ? 'Editar ideia' : 'Nova ideia'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors text-stone-500">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-semibold text-stone-600 uppercase tracking-wide mb-1 block">Título</label>
            <input
              className={`w-full border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900/20 ${errors.titulo ? 'border-red-400' : 'border-stone-200'}`}
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder="Ex: Reel mostrando os bastidores..."
            />
            {errors.titulo && <p className="text-xs text-red-500 mt-0.5">{errors.titulo}</p>}
          </div>

          <div>
            <label className="text-[12px] font-semibold text-stone-600 uppercase tracking-wide mb-1 block">Descrição</label>
            <textarea
              className={`w-full border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900/20 resize-none min-h-[100px] ${errors.descricao ? 'border-red-400' : 'border-stone-200'}`}
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              placeholder="Descreva sua ideia com detalhes..."
            />
            {errors.descricao && <p className="text-xs text-red-500 mt-0.5">{errors.descricao}</p>}
          </div>

          <div>
            <label className="text-[12px] font-semibold text-stone-600 uppercase tracking-wide mb-1 block">
              Links de referência <span className="text-stone-400 normal-case tracking-normal font-normal">(opcional)</span>
            </label>
            {links.map((link, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900/20"
                  value={link}
                  onChange={e => setLinks(ls => ls.map((l, j) => j === i ? e.target.value : l))}
                  placeholder="https://..."
                />
                {links.length > 1 && (
                  <button
                    onClick={() => setLinks(ls => ls.filter((_, j) => j !== i))}
                    className="p-2 rounded-xl hover:bg-stone-100 text-stone-400 hover:text-stone-700 transition-colors"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setLinks(ls => [...ls, ''])}
              className="text-xs text-stone-500 hover:text-stone-800 underline underline-offset-2 transition-colors"
            >
              + Adicionar outro link
            </button>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 disabled:opacity-50 transition-colors"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            {editing ? 'Salvar alterações' : 'Enviar ideia'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50 transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
