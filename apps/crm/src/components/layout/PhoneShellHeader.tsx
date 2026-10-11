import { ContextHelpLinks } from '../help/ContextHelpLinks';
import { PhoneNotificationsButton } from './PhoneNotifications';

/**
 * Phone shell header (below 768px), standing in for the desktop TopBar: fixed under the
 * banners, holding the status-bar inset, with the related-articles button and the
 * notification bell on the right. `.main-content` starts below it (style.css), so it
 * never covers the page or sits under the Dynamic Island.
 */
export default function PhoneShellHeader() {
  return (
    <div className="phone-shell-header" data-testid="phone-shell-header">
      <ContextHelpLinks />
      <PhoneNotificationsButton />
    </div>
  );
}
