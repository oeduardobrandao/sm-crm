import { useIsPhone } from '../../hooks/useIsPhone';
import { PopupEditorDesktop } from './PopupEditorDesktop';
import { PopupEditorPhone } from './PopupEditorPhone';
import type { PopupEditorModel } from './editor-model';

/**
 * Corpo do editor de popup, filho do `<form>` da página dentro do AdminFormSheet.
 * Puramente visual: estado, validação, upload e ordenação ficam em PopupsPage.
 */
export function PopupEditorBody({ model }: { model: PopupEditorModel }) {
  const isPhone = useIsPhone();
  return isPhone ? <PopupEditorPhone m={model} /> : <PopupEditorDesktop m={model} />;
}
