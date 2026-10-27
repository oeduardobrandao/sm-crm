import { useTranslation } from 'react-i18next';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';

/** "Fechar todos" / "Abrir todos" dos grupos da vista Lista (Agrupar por), acima
 *  da tabela e alinhado às setas dos grupos. Com algum grupo aberto, fecha todos;
 *  com todos recolhidos, abre todos. */
export function ListGroupsToggle({
  allCollapsed,
  onToggle,
}: {
  allCollapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('entregas');
  const Icon = allCollapsed ? ChevronsUpDown : ChevronsDownUp;
  return (
    <div className="list-groups-bar">
      <button type="button" className="list-groups-toggle" onClick={onToggle}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {allCollapsed ? t('listGroupsToggle.openAll') : t('listGroupsToggle.closeAll')}
      </button>
    </div>
  );
}
