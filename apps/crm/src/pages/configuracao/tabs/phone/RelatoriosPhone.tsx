import { useState, type ReactNode } from 'react';
import { Eye, ImageIcon, Mail, Palette } from 'lucide-react';
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
  const [artSheetOpen, setArtSheetOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <ConfigPhoneScreen
      title="Relatórios"
      subtitle={
        <>
          A marca que seus clientes veem no relatório mensal do Instagram.
          {!canEdit && <span className="phone-relatorios-readonly"> Somente leitura.</span>}
        </>
      }
      trailing={
        <ConfigNavTextButton onClick={onSave} disabled={saveDisabled} busy={saving}>
          Salvar
        </ConfigNavTextButton>
      }
    >
      <GroupedList
        header="Marca"
        footer={
          <>
            A mesma cor do Hub do Cliente. Marca títulos e destaques; os gráficos mantêm as cores
            próprias, para os dados seguirem legíveis. Arte da capa: formato quadrado (1:1), JPEG,
            PNG ou WebP, até 4MB. Salva assim que você envia. Sem arte, a capa fica apenas
            tipográfica.
          </>
        }
      >
        <Cell
          label="Cor de destaque"
          subtitle="Editar em Configurações · Hub"
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
          label="Arte da capa"
          subtitle={
            splashUploading ? 'Enviando…' : splashUrl ? 'Arte enviada' : 'Apenas tipográfica'
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

      <GroupedList
        aria-label="Envio por e-mail"
        footer="Envia o relatório automaticamente, todo mês, para os clientes com envio habilitado."
      >
        <Cell
          label="Enviar relatórios por e-mail"
          icon={<Mail />}
          iconColor="#0a84ff"
          disabled={emailDisabled}
          switch={{ checked: sendReportEmail, onCheckedChange: onSendReportEmailChange }}
        />
      </GroupedList>
      {brandingFailed && (
        <p role="alert" className="phone-relatorios-alert">
          Não foi possível carregar as configurações de relatório. Recarregue a página. Salvar agora
          sobrescreveria a sua marca com os valores padrão.
        </p>
      )}

      <GroupedList aria-label="Prévia" footer="O logo e o nome vêm da aba Workspace.">
        <Cell
          label="Pré-visualização"
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
        title="Arte da capa"
        message="Formato quadrado (1:1), JPEG, PNG ou WebP, até 4MB."
        actions={[
          {
            label: splashUrl ? 'Substituir arte' : 'Enviar arte',
            // The picker needs the tap itself: run before the sheet closes.
            immediate: true,
            disabled: splashUploading || !canEdit,
            onSelect: onPickSplash,
          },
          ...(splashUrl
            ? [
                {
                  label: 'Remover arte',
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
        title="Remover a arte da capa?"
        message="A capa dos próximos relatórios volta a ser apenas tipográfica. Você pode enviar outra arte quando quiser."
        actions={[
          {
            label: 'Remover arte',
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
        title="Prévia"
        description="O logo e o nome vêm da aba Workspace."
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
