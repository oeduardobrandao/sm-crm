import {
  useState,
  type ChangeEvent,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, Eye, ImagePlus, Plus, RefreshCw, X } from 'lucide-react';
import { BottomActionBar } from '@/components/mobile/BottomActionBar';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { FormRow } from '@/components/mobile/FormRow';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { PickerCell } from '@/components/mobile/PickerSheet';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import type { Cliente, DmButton } from '../../../store';
import type { AutomationFormState } from '../AutomationFormDialog';
import { MAX_BUTTON_TITLE, MAX_DM_BUTTONS } from '../dmButtons';
import './automacoesPhone.css';

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export interface AutomationFormPhoneProps {
  title: string;
  form: AutomationFormState;
  setForm: Dispatch<SetStateAction<AutomationFormState>>;
  clientLocked: boolean;
  selectableClientes: Cliente[];
  /** The picked client's Instagram can run automations; false shows the reconnect warning. */
  canAutomate: boolean;
  onClientChange: (clientId: number) => void;
  dmLimit: number;
  dmOverLimit: boolean;
  /** The desktop's post grids (production / published / live re-target picker). `afterSelect`
   *  runs after a pick, so the sheet closes like a picker. */
  renderTargetGrid: (afterSelect: () => void) => ReactNode;
  /** "Atualizar" of the published grid (hidden in re-target mode, like on desktop). */
  showRefresh: boolean;
  syncingPosts: boolean;
  onRefreshPosts: () => void;
  addKeyword: () => void;
  removeKeyword: (keyword: string) => void;
  mediaInputRef: RefObject<HTMLInputElement | null>;
  onMediaChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemoveMedia: () => void;
  updateButton: (index: number, patch: Partial<DmButton>) => void;
  removeButton: (index: number) => void;
  updateReply: (index: number, value: string) => void;
  removeReply: (index: number) => void;
  maxReplies: number;
  /** DmPreview + CommentReplyPreview, shown in the "Prévia" sheet. */
  previews: ReactNode;
  saving: boolean;
  onSave: () => void;
  /** Back and Cancelar: closes, asking first when there are unsaved changes. */
  onCancel: () => void;
  /** The in-dialog tour overlay, rendered inside the scroll container it measures. */
  tour: ReactNode;
}

/**
 * The automation form below 768px (FAutomacaoForm mockup): a full-screen pushed screen
 * with a nav bar, the fields as grouped sections, the post grids and the previews in
 * sheets, and Cancelar / Salvar pinned at the bottom. It renders the dialog's own state
 * and handlers; validation, save, media upload and the close guard all stay in
 * `AutomationFormDialog`.
 *
 * The scroll container carries `data-dialog-scroll`: TourOverlay measures the nearest
 * one and positions its spotlight inside it, so the tour must render in here and this
 * element must be the one that scrolls. Each tour anchor (`data-tour`) wraps a section.
 */
export function AutomationFormPhone({
  title,
  form,
  setForm,
  clientLocked,
  selectableClientes,
  canAutomate,
  onClientChange,
  dmLimit,
  dmOverLimit,
  renderTargetGrid,
  showRefresh,
  syncingPosts,
  onRefreshPosts,
  addKeyword,
  removeKeyword,
  mediaInputRef,
  onMediaChange,
  onRemoveMedia,
  updateButton,
  removeButton,
  updateReply,
  removeReply,
  maxReplies,
  previews,
  saving,
  onSave,
  onCancel,
  tour,
}: AutomationFormPhoneProps) {
  const { t } = useTranslation('automations');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const targetingPost = form.targetMode === 'post' && typeof form.clientId === 'number';
  const selected = form.selectedPost;
  const selectedLabel = selected
    ? selected.kind === 'production'
      ? selected.titulo || t('phone.post')
      : selected.media_caption
        ? truncate(selected.media_caption, 60)
        : t('viewPost')
    : null;
  const replies = form.publicReplies.length > 0 ? form.publicReplies : [''];

  return (
    <div className="phone-af__scroll" data-dialog-scroll>
      <PhoneNavBar className="phone-af__bar" onBack={onCancel} />
      <DialogTitle className="phone-af__title">{title}</DialogTitle>

      <div data-tour="campo-nome">
        <GroupedList>
          <FormRow
            label={t('form.nameLabel')}
            input={{
              id: 'automacao-nome',
              value: form.name,
              maxLength: 80,
              placeholder: t('form.namePlaceholder'),
              onChange: (e) => setForm((f) => ({ ...f, name: e.target.value })),
            }}
          />
        </GroupedList>
      </div>

      <div data-tour="campo-cliente">
        <GroupedList>
          <PickerCell<number>
            label={t('form.clientLabel')}
            sheetTitle={t('form.clientAria')}
            subtitle={form.clientId === '' ? t('form.clientPlaceholder') : undefined}
            placeholder={t('phone.choose')}
            disabled={clientLocked}
            searchable={selectableClientes.length > 8}
            options={selectableClientes
              .filter((c) => c.id != null)
              .map((c) => ({ value: c.id as number, label: c.nome }))}
            value={form.clientId === '' ? null : form.clientId}
            onChange={(v) => {
              if (v != null && v !== form.clientId) onClientChange(v);
            }}
          />
          {form.clientId !== '' && !canAutomate && (
            <li className="phone-cell phone-auto-li">
              <div className="phone-af__warning">
                <AlertTriangle aria-hidden="true" />
                <span>{t('form.reconnectWarning')}</span>
                <Link
                  to={`/clientes/${form.clientId}/redes-sociais`}
                  className="phone-af__warning-cta"
                >
                  {t('form.reconnectCta')}
                </Link>
              </div>
            </li>
          )}
        </GroupedList>
      </div>

      <div data-tour="campo-alvo">
        <GroupedList
          header={t('form.targetLabel')}
          footer={
            targetingPost && form.targetSource === 'production'
              ? t('form.productionHint')
              : undefined
          }
        >
          <li className="phone-cell phone-auto-li">
            <div className="phone-af__row">
              {/* 'deleted' (tombstone) matches no segment: nothing is selected until a
                  real target replaces it, as the desktop radios do. */}
              <SegmentedControl<AutomationFormState['targetMode']>
                aria-label={t('form.targetAria')}
                className="phone-af__segments"
                value={form.targetMode}
                onChange={(v) => {
                  if (v === 'todos')
                    setForm((f) => ({ ...f, targetMode: 'todos', selectedPost: null }));
                  else if (v === 'post') setForm((f) => ({ ...f, targetMode: 'post' }));
                }}
                options={[
                  { value: 'todos', label: t('form.targetAll') },
                  { value: 'post', label: t('form.targetPost') },
                ]}
              />
            </div>
          </li>
          {form.targetMode === 'deleted' && (
            <li className="phone-cell phone-auto-li">
              <div className="phone-af__warning">
                <AlertTriangle aria-hidden="true" />
                <span>{t('form.deletedTargetHint')}</span>
              </div>
            </li>
          )}
          {form.targetMode === 'post' && form.clientId === '' && (
            <li className="phone-cell phone-auto-li">
              <p className="phone-af__note">{t('form.selectClientForPosts')}</p>
            </li>
          )}
          {targetingPost && (
            <>
              <li className="phone-cell phone-auto-li">
                <div className="phone-af__row">
                  <span className="phone-af__row-label">{t('form.targetSourceLabel')}</span>
                  <SegmentedControl
                    aria-label={t('form.targetSourceLabel')}
                    className="phone-af__segments phone-af__segments--compact"
                    value={form.targetSource}
                    onChange={(v) => setForm((f) => ({ ...f, targetSource: v }))}
                    options={[
                      { value: 'production', label: t('form.targetSourceProduction') },
                      { value: 'published', label: t('form.targetSourcePublished') },
                    ]}
                  />
                </div>
              </li>
              <Cell
                label={selectedLabel ?? t('phone.post')}
                subtitle={
                  selected
                    ? selected.kind === 'production'
                      ? t('form.targetSourceProduction')
                      : t('form.targetSourcePublished')
                    : undefined
                }
                value={selected ? undefined : t('phone.choose')}
                chevron
                aria-haspopup="dialog"
                onClick={() => setPickerOpen(true)}
              />
            </>
          )}
        </GroupedList>
      </div>

      <div data-tour="campo-palavras">
        <GroupedList header={t('form.keywordsLabel')}>
          <li className="phone-cell phone-auto-li">
            <div className="phone-af__keywords">
              {form.keywords.map((k) => (
                <span key={k} className="phone-af__keyword">
                  {k}
                  <button
                    type="button"
                    onClick={() => removeKeyword(k)}
                    aria-label={t('form.keywordRemove', { keyword: k })}
                  >
                    <X aria-hidden="true" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                enterKeyHint="enter"
                className="phone-af__keyword-input"
                value={form.keywordInput}
                aria-label={t('form.keywordsLabel')}
                placeholder={t('form.keywordPlaceholder')}
                onChange={(e) => setForm((f) => ({ ...f, keywordInput: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
              />
            </div>
          </li>
        </GroupedList>
      </div>

      <div data-tour="campo-dm">
        <GroupedList
          header={form.dmMedia ? t('form.cardTitleLabel') : t('form.dmLabel')}
          footer={
            <span className={dmOverLimit ? 'phone-af__count--over' : undefined}>
              {form.dmMessage.length}/{dmLimit}
            </span>
          }
        >
          <li className="phone-cell phone-auto-li">
            <textarea
              id="automacao-dm"
              className="phone-af__textarea"
              rows={4}
              value={form.dmMessage}
              maxLength={dmLimit}
              aria-label={form.dmMedia ? t('form.cardTitleLabel') : t('form.dmLabel')}
              placeholder={t('form.dmPlaceholder')}
              onChange={(e) => setForm((f) => ({ ...f, dmMessage: e.target.value }))}
            />
          </li>
        </GroupedList>
      </div>

      <div data-tour="campo-midia">
        <input
          ref={mediaInputRef}
          id="automacao-midia"
          type="file"
          accept="image/jpeg,image/png,image/gif"
          onChange={onMediaChange}
          className="hidden"
        />
        <GroupedList header={t('form.mediaLabel')} footer={t('form.mediaHelp')}>
          {form.dmMedia ? (
            <>
              <li className="phone-cell phone-auto-li">
                <div className="phone-af__media">
                  {form.dmMediaPreviewUrl && (
                    <img src={form.dmMediaPreviewUrl} alt="" className="phone-af__media-thumb" />
                  )}
                  <span className="phone-af__media-name">{form.dmMedia.key.split('/').pop()}</span>
                  <button type="button" className="phone-text-button" onClick={onRemoveMedia}>
                    {t('form.mediaRemove')}
                  </button>
                </div>
              </li>
              <FormRow
                label={t('form.subtitleLabel')}
                accessory={<span className="phone-af__count">{form.dmSubtitle.length}/80</span>}
                input={{
                  id: 'automacao-subtitulo',
                  value: form.dmSubtitle,
                  maxLength: 80,
                  onChange: (e) => setForm((f) => ({ ...f, dmSubtitle: e.target.value })),
                }}
              />
            </>
          ) : form.dmMediaUploading ? (
            <li className="phone-cell phone-auto-li">
              <div className="phone-af__media">
                {form.dmMediaPreviewUrl && (
                  <img src={form.dmMediaPreviewUrl} alt="" className="phone-af__media-thumb" />
                )}
                <Spinner size="sm" />
              </div>
            </li>
          ) : (
            <Cell
              label={t('phone.mediaPick')}
              icon={<ImagePlus aria-hidden="true" />}
              value={t('phone.mediaLimit')}
              onClick={() => mediaInputRef.current?.click()}
            />
          )}
        </GroupedList>
      </div>

      <div data-tour="campo-botoes">
        <GroupedList header={t('form.buttonsLabel')} footer={t('form.buttonsHelp')}>
          {form.buttons.map((b, i) => (
            <li key={i} className="phone-cell phone-auto-li">
              <div className="phone-af__pair">
                <div className="phone-af__pair-fields">
                  <div className="phone-af__field-line">
                    <input
                      type="text"
                      className="phone-af__input phone-af__input--strong"
                      value={b.title}
                      maxLength={MAX_BUTTON_TITLE}
                      aria-label={t('form.buttonTitleLabel')}
                      placeholder={t('form.buttonTitleLabel')}
                      onChange={(e) => updateButton(i, { title: e.target.value })}
                    />
                    <span className="phone-af__count">
                      {b.title.length}/{MAX_BUTTON_TITLE}
                    </span>
                  </div>
                  <input
                    type="url"
                    inputMode="url"
                    className="phone-af__input phone-af__input--secondary"
                    value={b.url}
                    aria-label={t('form.buttonUrlLabel')}
                    placeholder="https://..."
                    onChange={(e) => updateButton(i, { url: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  className="phone-af__remove"
                  aria-label={t('form.removeButton')}
                  onClick={() => removeButton(i)}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
          {form.buttons.length < MAX_DM_BUTTONS && (
            <Cell
              label={t('form.addButton')}
              icon={<Plus aria-hidden="true" />}
              onClick={() =>
                setForm((f) => ({ ...f, buttons: [...f.buttons, { title: '', url: '' }] }))
              }
            />
          )}
        </GroupedList>
      </div>

      <div data-tour="campo-resposta">
        <GroupedList header={t('form.repliesLabel')} footer={t('form.repliesHelp')}>
          {replies.map((r, i) => (
            <li key={i} className="phone-cell phone-auto-li">
              <div className="phone-af__pair">
                <div className="phone-af__pair-fields">
                  <input
                    type="text"
                    className="phone-af__input"
                    value={r}
                    maxLength={500}
                    aria-label={t('form.replyVariationLabel', { index: i + 1 })}
                    placeholder={t('form.replyPlaceholderVariation')}
                    onChange={(e) => updateReply(i, e.target.value)}
                  />
                  <span className="phone-af__count">
                    {t('form.replyVariationLabel', { index: i + 1 })} · {r.length}/500
                  </span>
                </div>
                <button
                  type="button"
                  className="phone-af__remove"
                  aria-label={t('form.removeReply')}
                  onClick={() => removeReply(i)}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
          {form.publicReplies.length < maxReplies && (
            <Cell
              label={t('form.addReply')}
              icon={<Plus aria-hidden="true" />}
              onClick={() => setForm((f) => ({ ...f, publicReplies: [...f.publicReplies, ''] }))}
            />
          )}
        </GroupedList>
      </div>

      <GroupedList aria-label={t('phone.preview')}>
        <Cell
          label={t('phone.preview')}
          icon={<Eye aria-hidden="true" />}
          value={t('phone.previewValue')}
          chevron
          aria-haspopup="dialog"
          onClick={() => setPreviewOpen(true)}
        />
      </GroupedList>

      <BottomActionBar className="phone-af__actions">
        <button type="button" className="phone-af__action" onClick={onCancel}>
          {t('form.cancel')}
        </button>
        <button
          type="button"
          className="phone-af__action phone-af__action--primary"
          onClick={onSave}
          disabled={saving || form.dmMediaUploading}
        >
          {saving && <Spinner size="sm" />} {t('form.save')}
        </button>
      </BottomActionBar>

      <BottomSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={t('phone.pickPostTitle')}
        detents={['large']}
        className="phone-af-picker"
        headerLeading={
          showRefresh ? (
            <button
              type="button"
              className="phone-text-button"
              disabled={syncingPosts}
              onClick={onRefreshPosts}
            >
              {syncingPosts ? <Spinner size="sm" /> : <RefreshCw aria-hidden="true" />}
              {t('form.refreshPosts')}
            </button>
          ) : undefined
        }
      >
        {pickerOpen && (
          <div className="phone-af-picker__body">
            {renderTargetGrid(() => setPickerOpen(false))}
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={t('phone.preview')}
        detents={['large']}
        className="phone-af-preview"
      >
        {previewOpen && <div className="phone-af-preview__body">{previews}</div>}
      </BottomSheet>

      {tour}
    </div>
  );
}
