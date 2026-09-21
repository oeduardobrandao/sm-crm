import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AwaitingApprovalBadge } from '../AwaitingApprovalBadge';

describe('AwaitingApprovalBadge', () => {
  it('is a static badge that names the awaited approval in its tooltip', () => {
    render(<AwaitingApprovalBadge approvalName="Aprovação da Mídia" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Aguarda aprovação/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Aprovação da Mídia/)).toBeInTheDocument();
  });
});
