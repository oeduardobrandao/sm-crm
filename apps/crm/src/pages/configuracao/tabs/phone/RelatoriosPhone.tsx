import { useState, type ReactNode } from 'react';
import { Eye, ImageIcon, Mail, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { ReportPreview } from '../../ReportPreview';
import { ConfigNavTextButton, ConfigPhoneScreen } from '../../phone/ConfigPhoneScreen';
import './relatoriosPhone.css';

export interface RelatoriosPhoneProps {
  canEdit: boolean;
  brandColor: string;
  splashUrl: string | null;
  splashUploading: boolean;
  /** The tab's hidden file input (the same element and ref as on desktop). */
  splashInput: ReactNode;
  /** Opens the file picker. Must run inside the tap (iOS blocks a deferred click()). */
  onPickSplash: () => void;
  splashRemoveOpen: boolean;
  onSplashRemoveOpenChange: (open: boolean) => void;
  onRemoveSplash: () => void;
  sendReportEmail: boolean;
  onSendReportEmailChange: (value: boolean) => void;
  emailDisabled: boolean;
  brandingFailed: boolean;
  saving: boolean;
  saveDisabled: boolean;
  onSave: () => void;
  logoUrl: string | null;
  workspaceName: string;
  /** The "Modelos" list (ReportTemplatesCard's phone face), when the plan has it. */
  templates: ReactNode;
}

/** Configurações > Relatórios on phones. Presentational: state, uploads and the save
 *  mutation live in RelatoriosTab. */
export function RelatoriosPhone({
  canEdit,
  brandColor,
  splashUrl,
  splashUploading,
  splashInput,
  onPickSplash,
  splashRemoveOpen,
  onSplashRemoveOpenChange,
  onRemoveSplash,
  sendReportEmail,
  onSendReportEmailChange,
  emailDisabled,
  brandingFailed,
  saving,
  saveDisabled,
  onSave,
  logoUrl,
  workspaceName,
  templates,
}: RelatoriosPhoneProps) {
  const { t } = useTranslation('settingsHub');
  const [artSheetOpen, setArtSheetOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <ConfigPhoneScreen
      title={t('reports.title')}
      subtitle={
        <>
          {t('reports.subtitle')}
          {!canEdit && (
            <span className="phone-relatorios-readonly">{t('reports.readOnlySuffix')}</span>
          )}
        </>
      }
      trailing={
        <ConfigNavTextButton onClick={onSave} disabled={saveDisabled} busy={saving}>
          {t('actions.save')}
        </ConfigNavTextButton>
      }
    >
      <GroupedList header={t('reports.brand')} footer={t('reportsPhone.brandFooter')}>
        <Cell
          label={t('reports.accentColor')}
          subtitle={t('reports.editInHub')}
          icon={<Palette />}
          iconColor="#8e8e93"
          value={<span className="phone-relatorios-hex">{brandColor}</span>}
          accessory={
            <span
              className="phone-relatorios-swatch"
              style={{ background: brandColor }}
              aria-hidden="true"
            />
          }
          to="/configuracao/hub"
          data-testid="relatorios-brand-color"
        />
        <Cell
          label={t('reports.coverArt')}
          subtitle={
            splashUploading
              ? t('reports.uploading')
              : splashUrl
                ? t('reportsPhone.artUploaded')
                : t('reportsPhone.typographicOnly')
          }
          icon={
            splashUrl ? (
              <img
                src={splashUrl}
                alt=""
                className="phone-relatorios-thumb"
                data-busy={splashUploading || undefined}
              />
            ) : (
              <ImageIcon />
            )
          }
          iconColor={splashUrl ? undefined : '#5e5ce6'}
          chevron
          aria-haspopup="dialog"
          disabled={splashUploading || !canEdit}
          onClick={() => setArtSheetOpen(true)}
        />
      </GroupedList>
      {splashInput}

      <GroupedList aria-label={t('reportsPhone.emailAria')} footer={t('reports.sendEmailHint')}>
        <Cell
          label={t('reports.sendEmail')}
          icon={<Mail />}
          iconColor="#0a84ff"
          disabled={emailDisabled}
          switch={{ checked: sendReportEmail, onCheckedChange: onSendReportEmailChange }}
        />
      </GroupedList>
      {brandingFailed && (
        <p role="alert" className="phone-relatorios-alert">
          {t('reports.loadError')}
        </p>
      )}

      <GroupedList aria-label={t('reports.preview')} footer={t('reports.previewHint')}>
        <Cell
          label={t('reportsPhone.previewCell')}
          icon={<Eye />}
          iconColor="#30b0c7"
          chevron
          aria-haspopup="dialog"
          onClick={() => setPreviewOpen(true)}
        />
      </GroupedList>

      {templates}

      <ActionSheet
        open={artSheetOpen}
        onOpenChange={setArtSheetOpen}
        title={t('reports.coverArt')}
        message={t('reportsPhone.artSheetMessage')}
        actions={[
          {
            label: splashUrl ? t('reports.replaceArt') : t('reports.uploadArt'),
            // The picker needs the tap itself: run before the sheet closes.
            immediate: true,
            disabled: splashUploading || !canEdit,
            onSelect: onPickSplash,
          },
          ...(splashUrl
            ? [
                {
                  label: t('reports.removeArt'),
                  destructive: true,
                  disabled: splashUploading || !canEdit,
                  onSelect: () => onSplashRemoveOpenChange(true),
                },
              ]
            : []),
        ]}
      />

      <PhoneConfirmSheet
        open={splashRemoveOpen}
        title={t('reports.removeTitle')}
        message={t('reports.removeDescription')}
        actions={[
          {
            label: t('reports.removeArt'),
            destructive: true,
            disabled: splashUploading || !canEdit,
            onSelect: onRemoveSplash,
          },
        ]}
        onCancel={() => onSplashRemoveOpenChange(false)}
      />

      <BottomSheet
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={t('reports.preview')}
        description={t('reports.previewHint')}
        detents={['large']}
        showClose
      >
        <div className="phone-relatorios-preview">
          <ReportPreview
            accentColor={brandColor}
            splashUrl={splashUrl}
            logoUrl={logoUrl}
            workspaceName={workspaceName}
          />
        </div>
      </BottomSheet>
    </ConfigPhoneScreen>
  );
}
