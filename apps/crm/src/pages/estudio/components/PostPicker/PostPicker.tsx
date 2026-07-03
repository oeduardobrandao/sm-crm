// Client -> post cascade, or "Criar novo" (docs/estudio-design.md §6.1/§6.5). The middle "workflow"
// level of the cascade is folded into the post list itself (`getClientePosts` already returns
// `workflow_titulo` per post) rather than a separate workflow-selection step — same information,
// one fewer click, and it reuses an existing, already-tested query instead of a bespoke one.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getClientes } from '@/store/clients';
import { getClientePosts } from '@/store/posts';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { useEstudioEntryFlow } from '../../hooks/useEstudioEntryFlow';

// Must mirror post-design-manage/handler.ts's EDITABLE_STATUSES — posts outside this set are
// hidden from the picker rather than surfaced only to fail on open with `post_not_editable`.
const EDITABLE_STATUSES = new Set(['rascunho', 'revisao_interna', 'correcao_cliente']);

// Mirrors the handler's starterFormatForTipo: 'stories' posts have no design format and open
// only to fail with `unsupported_post_tipo` — hide them instead of dead-ending.
const INELIGIBLE_TIPOS = new Set(['stories']);

export default function PostPicker() {
  const navigate = useNavigate();
  const { t } = useTranslation('estudio');
  const { features } = useWorkspaceLimits();
  const { createFromScratch, creating } = useEstudioEntryFlow();
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);

  // Same convention as nav-data.ts's NAV_FEATURE gate: block only when the flag is EXPLICITLY
  // false (fail-open while entitlements load). The nav item is already hidden for these
  // workspaces — this covers direct-URL entry, which otherwise reached a fully interactive
  // picker whose "Criar novo" created real workflow/post rows before the editor's 403.
  const featureBlocked = features?.feature_estudio === false;

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const sortedClientes = [...clientes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const { data: posts = [] } = useQuery({
    queryKey: ['clientePosts', selectedClientId],
    queryFn: () => getClientePosts(selectedClientId!),
    enabled: selectedClientId !== null && !featureBlocked,
  });
  const editablePosts = posts.filter(
    (p) => EDITABLE_STATUSES.has(p.status) && !INELIGIBLE_TIPOS.has(p.tipo),
  );

  if (featureBlocked) {
    return (
      <div className="animate-up" style={{ padding: 'clamp(1.25rem, 3vw, 2.5rem)', maxWidth: 560 }}>
        <h1
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 'clamp(2rem, 4vw, 3.2rem)',
            fontWeight: 900,
          }}
        >
          {t('title')}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
          {t('featureBlocked')}
        </p>
      </div>
    );
  }

  async function handleCreateNew() {
    const client = clientes.find((c) => c.id === selectedClientId);
    if (!client?.id) return;
    try {
      const draft = await createFromScratch(client.id, client.nome);
      // The state marker scopes T2.3's abandonment cleanup to drafts THIS flow created — the
      // editor deletes the synthetic workflow/post again if the user leaves with zero layers.
      navigate(`/estudio/${draft.postId}`, {
        state: { estudioSyntheticDraft: { workflowId: draft.workflowId, postId: draft.postId } },
      });
    } catch (err: unknown) {
      toast.error(
        t('toast.createError', { error: err instanceof Error ? err.message : String(err) }),
      );
    }
  }

  return (
    <div className="animate-up" style={{ padding: 'clamp(1.25rem, 3vw, 2.5rem)', maxWidth: 560 }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 'clamp(2rem, 4vw, 3.2rem)',
            fontWeight: 900,
          }}
        >
          {t('title')}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
          {t('subtitle')}
        </p>
      </div>

      <div
        style={{
          background: 'var(--card-bg)',
          borderRadius: '8px',
          padding: '1.25rem',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div>
          <label
            className="block text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}
          >
            {t('picker.clientLabel')}
          </label>
          <select
            value={selectedClientId ?? ''}
            onChange={(e) =>
              setSelectedClientId(e.target.value ? parseInt(e.target.value, 10) : null)
            }
            disabled={creating}
            className="w-full pl-3 pr-10 py-2 text-sm border"
            style={{
              fontFamily: 'var(--font-main)',
              background: 'var(--surface-main)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-main)',
              borderRadius: '4px',
            }}
          >
            <option value="">{t('picker.selectClient')}</option>
            {sortedClientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>

        {selectedClientId !== null && (
          <div>
            <label
              className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}
            >
              {t('picker.postLabel')}
            </label>
            {editablePosts.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('picker.noEditablePosts')}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {editablePosts.map((post) => (
                  <li key={post.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/estudio/${post.id}`)}
                      className="w-full text-left px-3 py-2 text-sm rounded transition-colors"
                      style={{
                        background: 'var(--surface-main)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-main)',
                      }}
                    >
                      <span className="font-medium">{post.titulo}</span>
                      <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                        {post.workflow_titulo}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={handleCreateNew}
          disabled={selectedClientId === null || creating}
          className="btn-primary w-full text-sm font-semibold py-2.5"
          style={{ borderRadius: '8px', opacity: selectedClientId === null || creating ? 0.5 : 1 }}
        >
          {creating ? t('picker.creating') : t('picker.createNew')}
        </button>
      </div>
    </div>
  );
}
