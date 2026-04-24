import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeEffectiveInviteStatus, InviteStatusBadge, InviteTimeLeft } from '../ConfiguracaoPage';

describe('InviteStatusBadge', () => {
  it('renders PENDENTE for pending status', () => {
    render(<InviteStatusBadge status="pending" />);
    expect(screen.getByText('PENDENTE')).toHaveClass('badge-warning');
  });

  it('renders EXPIRADO for expired status', () => {
    render(<InviteStatusBadge status="expired" />);
    expect(screen.getByText('EXPIRADO')).toHaveClass('badge-danger');
  });

  it('renders ACEITO for accepted status', () => {
    render(<InviteStatusBadge status="accepted" />);
    expect(screen.getByText('ACEITO')).toHaveClass('badge-success');
  });

  it('falls back to raw status for unknown values', () => {
    render(<InviteStatusBadge status="unknown" />);
    expect(screen.getByText('unknown')).toHaveClass('badge-neutral');
  });
});

describe('InviteTimeLeft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows days and hours remaining for pending invite', () => {
    render(<InviteTimeLeft expiresAt="2026-04-25T00:00:00Z" status="pending" />);
    expect(screen.getByText('4d 12h restantes')).toBeTruthy();
  });

  it('shows only hours when less than a day remains', () => {
    render(<InviteTimeLeft expiresAt="2026-04-20T20:00:00Z" status="pending" />);
    expect(screen.getByText('8h restantes')).toBeTruthy();
  });

  it('renders nothing for expired status', () => {
    const { container } = render(<InviteTimeLeft expiresAt="2026-04-25T00:00:00Z" status="expired" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for accepted status', () => {
    const { container } = render(<InviteTimeLeft expiresAt="2026-04-25T00:00:00Z" status="accepted" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when expiresAt is empty', () => {
    const { container } = render(<InviteTimeLeft expiresAt="" status="pending" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when already past expiry', () => {
    const { container } = render(<InviteTimeLeft expiresAt="2026-04-19T00:00:00Z" status="pending" />);
    expect(container.innerHTML).toBe('');
  });
});

describe('computeEffectiveInviteStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps pending invites that have not expired', () => {
    const invites = [
      { id: '1', status: 'pending', expires_at: '2026-04-27T12:00:00Z', email: 'a@b.com' },
    ];
    const result = computeEffectiveInviteStatus(invites);
    expect(result[0].status).toBe('pending');
  });

  it('marks pending invites past expires_at as expired', () => {
    const invites = [
      { id: '2', status: 'pending', expires_at: '2026-04-19T00:00:00Z', email: 'c@d.com' },
    ];
    const result = computeEffectiveInviteStatus(invites);
    expect(result[0].status).toBe('expired');
  });

  it('does not modify already-expired invites', () => {
    const invites = [
      { id: '3', status: 'expired', expires_at: '2026-04-10T00:00:00Z', email: 'e@f.com' },
    ];
    const result = computeEffectiveInviteStatus(invites);
    expect(result[0].status).toBe('expired');
  });

  it('handles invites without expires_at', () => {
    const invites = [
      { id: '4', status: 'pending', email: 'g@h.com' },
    ];
    const result = computeEffectiveInviteStatus(invites);
    expect(result[0].status).toBe('pending');
  });

  it('processes mixed list correctly', () => {
    const invites = [
      { id: '1', status: 'pending', expires_at: '2026-04-27T12:00:00Z', email: 'active@b.com' },
      { id: '2', status: 'pending', expires_at: '2026-04-15T00:00:00Z', email: 'stale@b.com' },
      { id: '3', status: 'expired', expires_at: '2026-04-10T00:00:00Z', email: 'old@b.com' },
    ];
    const result = computeEffectiveInviteStatus(invites);
    expect(result[0].status).toBe('pending');
    expect(result[1].status).toBe('expired');
    expect(result[2].status).toBe('expired');
  });

  it('does not mutate the original array', () => {
    const invites = [
      { id: '1', status: 'pending', expires_at: '2026-04-15T00:00:00Z', email: 'x@y.com' },
    ];
    computeEffectiveInviteStatus(invites);
    expect(invites[0].status).toBe('pending');
  });
});
