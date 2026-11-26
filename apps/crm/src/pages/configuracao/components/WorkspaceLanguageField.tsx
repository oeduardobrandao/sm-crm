import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '@mesaas/i18n';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { useAuth } from '../../../context/AuthContext';
import { getCurrentWorkspace, setWorkspaceLanguage } from '../../../store';

const languageLabel = (lang: string) => (lang === 'en' ? 'English (US)' : 'Português (Brasil)');

/**
 * Workspace language: a select for the owner, plain text for everyone else.
 * Shared by the desktop card (WorkspaceTab) and the phone screen (WorkspacePhone).
 */
export function WorkspaceLanguageField({ variant }: { variant: 'desktop' | 'phone' }) {
  const { t } = useTranslation('settings');
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const isOwner = role === 'owner';

  const { data: workspace } = useQuery({
    queryKey: ['currentWorkspace'],
    queryFn: getCurrentWorkspace,
  });
  if (!workspace) return null;
  const current = workspace.language === 'en' ? 'en' : 'pt';

  const change = async (value: string) => {
    const next = value === 'en' ? 'en' : 'pt';
    if (next === current) return;
    try {
      const saved = await setWorkspaceLanguage(next);
      await queryClient.invalidateQueries({ queryKey: ['currentWorkspace'] });
      // Saves the owner's explicit choice for this browser and switches the UI.
      changeLanguage(saved);
      toast.success(t('workspace.languageUpdated'));
    } catch {
      toast.error(t('workspace.languageError'));
    }
  };

  if (variant === 'phone') {
    return (
      <>
        <GroupedList header={t('workspace.language')} footer={t('workspace.languageHint')}>
          <Cell
            label={t('workspace.language')}
            value={languageLabel(current)}
            chevron={isOwner}
            onClick={isOwner ? () => setSheetOpen(true) : undefined}
            aria-haspopup={isOwner ? 'dialog' : undefined}
          />
        </GroupedList>
        {isOwner && (
          <ActionSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            title={t('workspace.language')}
            hideTitle
            actions={(['pt', 'en'] as const).map((lang) => ({
              label: languageLabel(lang),
              onSelect: () => change(lang),
            }))}
          />
        )}
      </>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <Label style={{ display: 'block', marginBottom: 6 }}>{t('workspace.language')}</Label>
      {isOwner ? (
        <Select value={current} onValueChange={change}>
          <SelectTrigger aria-label={t('workspace.language')} className="max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pt">{languageLabel('pt')}</SelectItem>
            <SelectItem value="en">{languageLabel('en')}</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <p style={{ margin: 0 }}>{languageLabel(current)}</p>
      )}
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 6 }}>
        {t('workspace.languageHint')}
      </p>
    </div>
  );
}
