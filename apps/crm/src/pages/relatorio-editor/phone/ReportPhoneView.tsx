// Relatório e modelos no celular (D27): só leitura e exportação. O layout é o do
// autosave da página (um template aplicado aparece na hora), renderizado como o
// cliente vê (BlockRenderer em modo view). Editar fica no computador: as
// ferramentas do editor dependem de hover e de uma coluna de 880px.
import { useRef, useState, type ReactNode } from 'react';
import { Download, ExternalLink, Info, Monitor, MoreHorizontal } from 'lucide-react';
import { BlockRenderer } from '@mesaas/report-blocks/BlockRenderer';
import type { ReportDocSnapshot, ReportLayout } from '@mesaas/report-blocks/types';
import { ActionSheet, type ActionSheetAction } from '@/components/mobile/ActionSheet';
import { BottomActionBar } from '@/components/mobile/BottomActionBar';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { usePhoneChrome } from '@/components/layout/PhoneLayoutContext';
import './reportPhone.css';

export const PHONE_EDIT_NOTE = 'Edite o layout no computador.';

export interface ReportPhoneViewProps {
  title: string;
  /** "Cliente · Período" no relatório; o tipo do modelo nas páginas de modelo. */
  subtitle?: ReactNode;
  /** Para onde o Voltar vai quando a tela foi aberta direto (link, recarga). */
  fallbackTo: string;
  backLabel?: string;
  /** Itens do "…". Sem itens, o botão não aparece. */
  actions?: ActionSheetAction[];
  /** Nome do botão "…" e da folha de ações. */
  actionsLabel?: string;
  /** Aviso extra sob o "Edite no computador" (ex.: dados de exemplo dos modelos). */
  sampleNote?: ReactNode;
  layout: ReportLayout;
  snapshot: ReportDocSnapshot;
  /** A barra inferior (Exportar PDF), quando a tela tem uma. Com ela, a tab bar sai
   * (tela empurrada com ação própria no rodapé, como o editor de post). */
  bottomBar?: ReactNode;
}

export function ReportPhoneView({
  title,
  subtitle,
  fallbackTo,
  backLabel = 'Voltar',
  actions = [],
  actionsLabel = 'Ações do relatório',
  sampleNote,
  layout,
  snapshot,
  bottomBar,
}: ReportPhoneViewProps) {
  usePhoneChrome({ tabBar: !bottomBar });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="phone-report">
      <PhoneNavBar
        backLabel={backLabel}
        fallbackTo={fallbackTo}
        trailing={
          actions.length > 0 ? (
            <PhoneIconButton
              ref={menuButtonRef}
              label={actionsLabel}
              aria-haspopup="dialog"
              onClick={() => setMenuOpen(true)}
            >
              <MoreHorizontal aria-hidden="true" />
            </PhoneIconButton>
          ) : undefined
        }
      />
      <div className="phone-report__head">
        <h1 className="phone-report__title">{title}</h1>
        {subtitle && <p className="phone-report__subtitle">{subtitle}</p>}
      </div>
      <p role="note" className="phone-report__note">
        <Monitor aria-hidden="true" />
        {PHONE_EDIT_NOTE}
      </p>
      {sampleNote && (
        <p role="note" className="phone-report__note phone-report__note--muted">
          <Info aria-hidden="true" />
          {sampleNote}
        </p>
      )}
      <article className="phone-report__doc" aria-label={title}>
        <BlockRenderer layout={layout} snapshot={snapshot} mode="view" />
      </article>
      {bottomBar}
      {actions.length > 0 && (
        <ActionSheet
          open={menuOpen}
          onOpenChange={setMenuOpen}
          title={actionsLabel}
          hideTitle
          actions={actions}
          returnFocusRef={menuButtonRef}
        />
      )}
    </div>
  );
}

export interface ReportExportBarProps {
  exporting: boolean;
  /** URL do PDF já gerado. Presente, a barra mostra "Abrir PDF" em vez de exportar. */
  pdfUrl: string | null;
  onExport: () => void;
}

/**
 * "Exportar PDF" do celular. A geração leva de 10 a 60 s; quando a URL chega, a aba
 * nova não é aberta por código (o iOS Safari bloqueia uma abertura fora do toque e,
 * num app nativo, trocar a página pelo PDF deixaria a pessoa sem Voltar). A barra vira
 * um link "Abrir PDF" de verdade, que a pessoa toca: um gesto novo.
 */
export function ReportExportBar({ exporting, pdfUrl, onExport }: ReportExportBarProps) {
  return (
    <BottomActionBar className="phone-report__bar">
      {pdfUrl ? (
        <>
          <button
            type="button"
            className="phone-report__bar-secondary"
            disabled={exporting}
            onClick={onExport}
          >
            Gerar novamente
          </button>
          <a
            className="phone-report__bar-primary"
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink aria-hidden="true" />
            Abrir PDF
          </a>
        </>
      ) : (
        <button
          type="button"
          className="phone-report__bar-primary"
          disabled={exporting}
          aria-busy={exporting || undefined}
          onClick={onExport}
        >
          <Download aria-hidden="true" />
          {exporting ? 'Gerando PDF…' : 'Exportar PDF'}
        </button>
      )}
    </BottomActionBar>
  );
}
