import { BrandMark } from '@/components/mobile/BrandMark';
import { ContextHelpLinks } from '../help/ContextHelpLinks';
import { PhoneNotificationsButton } from './PhoneNotifications';

/**
 * The shell's own header actions on phones: the related-articles button (renders nothing
 * when the route has no articles) and the notification bell. Shared by the shell bar
 * below and by `PhonePageHeader`, which puts them at the end of a page's action row.
 */
export function PhoneShellActions() {
  return (
    <div className="phone-shell-actions">
      <ContextHelpLinks />
      <PhoneNotificationsButton />
    </div>
  );
}

export { ContextHelpLinks, PhoneNotificationsButton };

/**
 * Phone shell header (below 768px), standing in for the desktop TopBar: fixed under the
 * banners, holding the status-bar inset, with the Mesaas mark on the left and the
 * related-articles button and the notification bell on the right. `.main-content` starts below it (style.css), so it
 * never covers the page or sits under the Dynamic Island. Pages that render their own
 * `PhonePageHeader` / `PhoneNavBar` hide it (`usePhoneChrome({ pageHeader: true })`).
 */
export default function PhoneShellHeader() {
  return (
    <div className="phone-shell-header" data-testid="phone-shell-header">
      <BrandMark />
      <PhoneShellActions />
    </div>
  );
}
