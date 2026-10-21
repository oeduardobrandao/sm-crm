// Post Express no celular (PLAN F4.5, mockup FPostExpress): as etapas viram seções
// agrupadas, o envio vai para a barra inferior e a confirmação (com o progresso da
// publicação) para uma folha. Estado, regras e comandos são todos da página
// (ExpressPostPage): este componente só desenha e repassa os toques.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@mesaas/i18n';
import { AlertCircle, Eye, Link2, Send, type LucideIcon } from 'lucide-react';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { PickerCell } from '@/components/mobile/PickerSheet';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { BottomActionBar } from '@/components/mobile/BottomActionBar';
import type { PostMedia } from '../../store';
import { PostMediaGallery } from '../entregas/components/PostMediaGallery';
import { ExpressPreview } from './ExpressPreview';
import './expressPostPhone.css';

/** Acima disso a lista de clientes ganha busca. */
const SEARCHABLE_FROM = 8;

export interface ExpressTypeChip {
  label: string;
  color: string;
  bg: string;
  icon: LucideIcon;
}

export interface ExpressPostPhoneProps {
  isStory: boolean;
  onStoryChange: (story: boolean) => void;
  loading: boolean;
  creatingDraft: boolean;
  clients: { id: number; nome: string }[];
  selectedClientId: number | null;
  onClientChange: (clientId: number | null) => void;
  igAccount: { username: string | null; profile_picture_url: string | null } | null;
  warningMessage: string | null;
  postId: number | null;
  mediaList: PostMedia[];
  maxFiles: number | undefined;
  onMediaChange: (media: PostMedia[]) => void;
  typeChip: ExpressTypeChip | null;
  caption: string;
  onCaptionChange: (caption: string) => void;
  maxCaption: number;
  approvalAllowed: boolean;
  mode: 'now' | 'approval';
  onModeChange: (mode: 'now' | 'approval') => void;
  hubTokenLoading: boolean;
  hubTokenUsable: boolean;
  canPublish: boolean;
  confirmOpen: boolean;
  onConfirmOpenChange: (open: boolean) => void;
  publishing: boolean;
  publishPct: number;
  onPublishNow: () => void;
  onSendForApproval: () => void;
}

const formatCount = (n: number) => n.toLocaleString(getIntlLocale());

export function ExpressPostPhone(props: ExpressPostPhoneProps) {
  const {
    isStory,
    onStoryChange,
    loading,
    creatingDraft,
    clients,
    selectedClientId,
    onClientChange,
    igAccount,
    warningMessage,
    postId,
    mediaList,
    maxFiles,
    onMediaChange,
    typeChip,
    caption,
    onCaptionChange,
    maxCaption,
    approvalAllowed,
    mode,
    onModeChange,
    hubTokenLoading,
    hubTokenUsable,
    canPublish,
    confirmOpen,
    onConfirmOpenChange,
    publishing,
    publishPct,
    onPublishNow,
    onSendForApproval,
  } = props;
  const { t } = useTranslation('posts');
  const { t: tc } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const hasDraft = postId !== null;

  const submitLabel =
    mode === 'approval'
      ? t('approval.button')
      : t(isStory ? 'publish.buttonStories' : 'publish.button');
  const sendNote = t(mode === 'approval' ? 'approval.note' : 'publish.note');
  const confirmTitle = publishing
    ? t('publish.publishingTitle')
    : mode === 'approval'
      ? t('approval.confirmTitle')
      : t('publish.confirmTitle');
  const confirmText = publishing
    ? t('publish.publishingDescription')
    : mode === 'approval'
      ? t('approval.confirmDescription')
      : t('publish.confirmDescription');

  const clientFooter =
    warningMessage && selectedClientId ? (
      <span className="phone-express__warning" role="alert">
        <AlertCircle aria-hidden="true" />
        <span>
          {warningMessage}{' '}
          <Link to={`/clientes/${selectedClientId}/redes-sociais`}>Reconectar</Link>
        </span>
      </span>
    ) : clients.length === 0 ? (
      `${t('empty.noClientsWithIg')} Conecte uma conta Instagram em um cliente para começar a publicar.`
    ) : undefined;

  return (
    <div className="phone-express">
      <PhonePageHeader title={t('title')} subtitle={t('subtitle')}>
        <SegmentedControl
          aria-label={t('format.label')}
          className="phone-express__format"
          value={isStory ? 'stories' : 'post'}
          onChange={(v) => onStoryChange(v === 'stories')}
          options={[
            { value: 'post', label: t('format.post'), disabled: loading },
            { value: 'stories', label: t('format.stories'), disabled: loading },
          ]}
        />
      </PhonePageHeader>

      <GroupedList aria-label={t('labels.client')} footer={clientFooter}>
        <PickerCell<number>
          label={t('labels.client')}
          options={clients.map((c) => ({ value: c.id, label: c.nome }))}
          value={selectedClientId}
          onChange={onClientChange}
          placeholder={t('select.client')}
          searchable={clients.length > SEARCHABLE_FROM}
          disabled={loading || creatingDraft || clients.length === 0}
          subtitle={igAccount ? `@${igAccount.username ?? 'conta'}` : undefined}
          data-testid="express-client"
        />
        {clients.length === 0 && <Cell label={t('empty.connectAccount')} to="/clientes" />}
      </GroupedList>

      {hasDraft ? (
        <section className="phone-express__card" aria-label={t('labels.media')}>
          <PostMediaGallery
            variant="phone"
            postId={postId}
            forStories={isStory}
            maxFiles={maxFiles}
            onChange={onMediaChange}
          />
          {typeChip && (
            <span
              className="phone-express__type"
              style={{ color: typeChip.color, background: typeChip.bg }}
            >
              <typeChip.icon aria-hidden="true" /> {typeChip.label}
            </span>
          )}
        </section>
      ) : (
        <GroupedList header={t('labels.media')}>
          <Cell
            className="phone-express__muted-cell"
            label={creatingDraft ? t('empty.preparingDraft') : t('steps.needClient')}
          />
        </GroupedList>
      )}

      <section className="phone-kit phone-group">
        <h2 className="phone-group__header">{t('labels.caption')}</h2>
        {isStory ? (
          <div className="phone-express__card phone-express__card--muted">
            <AlertCircle aria-hidden="true" />
            <span>{t('story.captionHidden')}</span>
          </div>
        ) : (
          <div className="phone-express__card">
            <textarea
              className="phone-express__caption"
              aria-label={t('labels.caption')}
              value={caption}
              onChange={(e) => onCaptionChange(e.target.value.slice(0, maxCaption))}
              placeholder={t('captionPlaceholder')}
              disabled={!hasDraft || loading}
              rows={5}
            />
            <div className="phone-express__counter">
              {formatCount(caption.length)} / {formatCount(maxCaption)}
            </div>
          </div>
        )}
      </section>

      <section className="phone-kit phone-group phone-express__send">
        <h2 className="phone-group__header">{t('steps.send')}</h2>
        {approvalAllowed && (
          <SegmentedControl
            aria-label={t('mode.label')}
            className="phone-express__mode"
            value={mode}
            onChange={onModeChange}
            options={[
              { value: 'now', label: t('mode.publishNow'), disabled: loading },
              { value: 'approval', label: t('mode.approval'), disabled: loading },
            ]}
          />
        )}
        {mode === 'approval' &&
          selectedClientId &&
          !hubTokenLoading &&
          (hubTokenUsable ? (
            <p className="phone-express__hub phone-express__hub--ok">
              <Link2 aria-hidden="true" />
              {t('approval.hubLinkActive')}
            </p>
          ) : (
            <p className="phone-express__hub phone-express__hub--warn" role="alert">
              <AlertCircle aria-hidden="true" />
              <span>
                {t('approval.noHubLink')}{' '}
                <Link to={`/clientes/${selectedClientId}`}>{t('approval.noHubLinkAction')}</Link>
              </span>
            </p>
          ))}
      </section>

      {/* Mesmas condições do desktop: prévia com rascunho e conta; nota com rascunho. */}
      {hasDraft && igAccount && (
        <GroupedList aria-label={t('labels.preview')} footer={sendNote}>
          <Cell
            icon={<Eye />}
            label={t('labels.preview')}
            chevron
            aria-haspopup="dialog"
            onClick={() => setPreviewOpen(true)}
          />
        </GroupedList>
      )}
      {hasDraft && !igAccount && <p className="phone-express__note">{sendNote}</p>}

      <BottomActionBar aboveTabBar className="phone-express__bar">
        <button
          type="button"
          data-testid="express-submit"
          className="phone-express__primary"
          disabled={!canPublish}
          onClick={() => onConfirmOpenChange(true)}
        >
          <Send aria-hidden="true" />
          {submitLabel}
        </button>
      </BottomActionBar>

      {igAccount && (
        <BottomSheet
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          title={t('labels.preview')}
          detents={['fit']}
          className="phone-express-preview-sheet"
        >
          <div className="phone-express__preview">
            <ExpressPreview
              igAccount={igAccount}
              isStory={isStory}
              mediaList={mediaList}
              caption={caption}
              emptyLabel={t('empty.mediaPlaceholder')}
            />
          </div>
        </BottomSheet>
      )}

      <BottomSheet
        open={confirmOpen}
        onOpenChange={onConfirmOpenChange}
        title={confirmTitle}
        detents={['fit']}
        showClose={!publishing}
        className="phone-express-confirm-sheet"
      >
        <div className="phone-express__confirm">
          <p className="phone-express__confirm-text">{confirmText}</p>
          {publishing ? (
            <div className="phone-express__progress">
              <div className="phone-express__progress-row">
                <span>{publishPct < 100 ? t('progress.sending') : t('progress.done')}</span>
                <span className="phone-express__progress-pct">{publishPct}%</span>
              </div>
              <div
                className="phone-express__progress-track"
                role="progressbar"
                aria-label={t('progress.sending')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={publishPct}
              >
                <div
                  className="phone-express__progress-fill"
                  data-done={publishPct >= 100 || undefined}
                  style={{ width: `${publishPct}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="phone-express__confirm-actions">
              <button
                type="button"
                className="phone-express__secondary"
                disabled={loading}
                onClick={() => onConfirmOpenChange(false)}
              >
                {tc('actions.cancel')}
              </button>
              {mode === 'approval' ? (
                <button
                  type="button"
                  className="phone-express__primary"
                  disabled={loading}
                  onClick={onSendForApproval}
                >
                  {t('approval.sendAction')}
                </button>
              ) : (
                <button
                  type="button"
                  className="phone-express__primary phone-express__primary--publish"
                  disabled={loading}
                  onClick={onPublishNow}
                >
                  {t('publish_action')}
                </button>
              )}
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
