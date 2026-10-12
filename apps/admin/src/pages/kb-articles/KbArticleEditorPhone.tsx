import { useRef, useState } from 'react';
import { Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import { Cell, FormRow, GroupedList, PhoneIconButton, SegmentedControl } from '@mesaas/ios-kit';
import {
  KB_CATEGORIES as CATEGORIES,
  ALL_KB_CATEGORIES as ALL_CATEGORIES,
} from '../../lib/kb-categories';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { STATUS_LABELS, routeLabel, type KbArticleEditorViewProps } from './editor-view';

type Section = 'conteudo' | 'detalhes' | 'contexto';

const SECTIONS: Array<{ value: Section; label: string }> = [
  { value: 'conteudo', label: 'Conteúdo' },
  { value: 'detalhes', label: 'Detalhes' },
  { value: 'contexto', label: 'Contexto' },
];

const tabId = (s: Section) => `kb-article-tab-${s}`;
const panelId = (s: Section) => `kb-article-panel-${s}`;

export function KbArticleEditorPhone(p: KbArticleEditorViewProps) {
  const [section, setSection] = useState<Section>('conteudo');
  const coverInputRef = useRef<HTMLInputElement>(null);
  const { values: v, set } = p;

  const meta = [
    v.slug ? `/${v.slug}` : null,
    v.category ? (CATEGORIES[v.category] ?? v.category) : null,
    STATUS_LABELS[v.status],
  ]
    .filter(Boolean)
    .join(' · ');

  // All three panels stay mounted (hidden, not unmounted): the TipTap editor keeps its
  // document and undo history while the admin checks Detalhes or Contexto.
  const panel = (s: Section) => ({
    id: panelId(s),
    role: 'tabpanel' as const,
    'aria-labelledby': tabId(s),
    hidden: section !== s,
  });

  return (
    <>
      <PageHeader
        title={p.isEdit ? 'Editar artigo' : 'Novo artigo'}
        back={{ to: '/admin/kb-articles', label: 'Artigos' }}
        phoneActions={
          <>
            {p.onDelete && (
              <PhoneIconButton
                label="Excluir artigo"
                onClick={p.onDelete}
                disabled={p.deleting}
                className="!text-destructive"
              >
                <Trash2 aria-hidden="true" />
              </PhoneIconButton>
            )}
            <button
              type="button"
              onClick={p.onSave}
              disabled={!p.canSave || p.saving}
              className="h-9 rounded-full bg-primary px-3.5 text-[15px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {p.saving ? 'Salvando…' : 'Salvar'}
            </button>
          </>
        }
      >
        <SegmentedControl
          aria-label="Editor"
          semantics="tablist"
          options={SECTIONS.map((s) => ({
            value: s.value,
            label: s.label,
            id: tabId(s.value),
            controls: panelId(s.value),
          }))}
          value={section}
          onChange={setSection}
        />
      </PageHeader>

      <div {...panel('conteudo')} className="px-1">
        <input
          type="text"
          aria-label="Título"
          aria-required="true"
          value={v.title}
          onChange={(e) => set.title(e.target.value)}
          placeholder="Título do artigo"
          className="w-full bg-transparent px-3 font-sf text-[26px] font-bold leading-tight text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
        <p className="mb-4 mt-1 px-3 text-[13px] text-muted-foreground">{meta}</p>
        <div className="rounded-xl border border-border bg-card text-[17px] [&_.post-editor-toolbar]:flex-wrap [&_.post-editor-toolbar]:rounded-t-xl [&_.post-editor-toolbar_button]:h-9 [&_.post-editor-toolbar_button]:w-9">
          {p.editor}
        </div>
      </div>

      <div {...panel('detalhes')}>
        <GroupedList aria-label="Detalhes do artigo">
          <FormRow
            label="Slug"
            error={p.slugError}
            input={{
              value: v.slug,
              onChange: (e) => set.slug(e.target.value),
              placeholder: 'como-adicionar',
              autoCapitalize: 'none',
              autoCorrect: 'off',
              spellCheck: false,
              'aria-required': true,
            }}
          />
          <FormRow label="Categoria">
            {(field) => (
              <select
                {...field}
                aria-required="true"
                value={v.category}
                onChange={(e) => set.category(e.target.value)}
                className="phone-field__select"
              >
                <option value="">Selecionar</option>
                {ALL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORIES[c]}
                  </option>
                ))}
              </select>
            )}
          </FormRow>
          <FormRow label="Status">
            {(field) => (
              <select
                {...field}
                value={v.status}
                onChange={(e) => set.status(e.target.value as 'draft' | 'published')}
                className="phone-field__select"
              >
                <option value="draft">{STATUS_LABELS.draft}</option>
                <option value="published">{STATUS_LABELS.published}</option>
              </select>
            )}
          </FormRow>
          <FormRow
            label="Tags"
            input={{
              value: v.tags,
              onChange: (e) => set.tags(e.target.value),
              placeholder: 'instagram, tutorial',
            }}
          />
          <FormRow
            label="Ordem de exibição"
            input={{
              type: 'number',
              inputMode: 'numeric',
              min: 0,
              value: v.displayOrder,
              onChange: (e) => set.displayOrder(e.target.value),
            }}
          />
          <FormRow
            label="Resumo"
            helper="Até 200 caracteres."
            textarea={{
              value: v.excerpt,
              onChange: (e) => set.excerpt(e.target.value),
              placeholder: 'Breve descrição do artigo',
              rows: 3,
              maxLength: 200,
            }}
          />
        </GroupedList>

        <GroupedList header="Imagem de capa">
          {p.coverPreview && (
            <li className="phone-cell">
              <img
                src={p.coverPreview}
                alt="Prévia da capa"
                className="max-h-48 w-full object-cover"
              />
            </li>
          )}
          <FormRow
            label="URL"
            input={{
              value: v.coverUrl,
              onChange: (e) => set.coverUrl(e.target.value),
              placeholder: 'https://...',
              autoCapitalize: 'none',
              inputMode: 'url',
            }}
          />
          <Cell
            label={p.coverUploading ? 'Enviando…' : 'Enviar imagem'}
            icon={
              p.coverUploading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Upload className="text-primary" />
              )
            }
            disabled={p.coverUploading}
            onClick={() => coverInputRef.current?.click()}
          />
          {v.coverUrl && (
            <Cell label="Remover capa" icon={<X />} destructive onClick={() => set.coverUrl('')} />
          )}
        </GroupedList>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) p.onCoverFile(file);
            e.target.value = '';
          }}
        />
      </div>

      <div {...panel('contexto')}>
        {p.contextEnabled ? (
          <>
            <GroupedList
              header="Telas do CRM"
              footer="O artigo aparece como sugestão nestas telas do CRM."
            >
              {p.contextLinks.length === 0 ? (
                <Cell label="Nenhuma tela ainda." />
              ) : (
                p.contextLinks.map((link) => {
                  const label = routeLabel(link.route_pattern);
                  return (
                    <Cell
                      key={link.id}
                      label={label}
                      subtitle={link.route_pattern}
                      accessory={
                        <PhoneIconButton
                          label={`Remover ${label}`}
                          onClick={() => p.onRemoveContextLink(link.id)}
                        >
                          <X aria-hidden="true" />
                        </PhoneIconButton>
                      }
                    />
                  );
                })
              )}
            </GroupedList>
            <GroupedList aria-label="Adicionar tela">
              <FormRow
                label="Tela"
                accessory={
                  <Button
                    type="button"
                    size="sm"
                    className="ml-2 h-8 px-3 text-[13px]"
                    onClick={p.onAddContextLink}
                    disabled={!p.selectedRoute}
                  >
                    <Plus aria-hidden="true" />
                    Adicionar
                  </Button>
                }
              >
                {(field) => (
                  <select
                    {...field}
                    value={p.selectedRoute}
                    onChange={(e) => p.onSelectedRouteChange(e.target.value)}
                    className="phone-field__select"
                  >
                    <option value="">Selecionar</option>
                    {p.availableRoutes.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                )}
              </FormRow>
            </GroupedList>
          </>
        ) : (
          <GroupedList aria-label="Contexto">
            <Cell label="Salve o artigo para escolher em quais telas do CRM ele aparece." />
          </GroupedList>
        )}
      </div>
    </>
  );
}
