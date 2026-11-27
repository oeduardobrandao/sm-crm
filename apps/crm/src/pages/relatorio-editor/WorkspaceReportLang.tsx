// Idioma dos blocos do relatório no CRM: o do workspace, o mesmo que o Hub e o PDF usam
// (hub-report-docs lê workspaces.language). Não segue o idioma da interface: quem escolheu
// inglês num workspace em português vê o editor em inglês e o documento como o cliente o verá.
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ReportLangContext, normalizeReportLang } from '@mesaas/report-blocks/i18n';
import { getCurrentWorkspace } from '@/store/workspace';

export function WorkspaceReportLang({ children }: { children: ReactNode }) {
  // Mesma query do WorkspaceLanguageSync e das abas de Configurações: um fetch só.
  const { data } = useQuery({ queryKey: ['currentWorkspace'], queryFn: getCurrentWorkspace });
  return (
    <ReportLangContext.Provider value={normalizeReportLang(data?.language)}>
      {children}
    </ReportLangContext.Provider>
  );
}
