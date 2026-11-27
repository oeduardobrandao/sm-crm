import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '@mesaas/i18n';
import NotificationPopover from '../NotificationPopover';
import FinancialRestrictionScreen from '../FinancialRestrictionScreen';

describe('app shell in English', () => {
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('renders the notification popover with English copy', async () => {
    await i18n.changeLanguage('en');
    render(
      <NotificationPopover
        notifications={[]}
        isLoading={false}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={vi.fn()}
        onDismiss={vi.fn()}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText('No notifications')).toBeInTheDocument();
    expect(screen.getByLabelText('Mark all as read')).toBeInTheDocument();
  });

  it('renders the financial restriction screen with English copy', async () => {
    await i18n.changeLanguage('en');
    render(<FinancialRestrictionScreen variant="contratos" />);
    expect(screen.getByText('Contracts access restricted')).toBeInTheDocument();
  });
});
