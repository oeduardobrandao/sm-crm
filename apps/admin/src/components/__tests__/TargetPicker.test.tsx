import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TargetPicker, type TargetValue } from '../TargetPicker';

const plans = [
  { id: 'free', name: 'Free' },
  { id: 'pro', name: 'Pro' },
];
const workspaces = [
  { id: 'w1', name: 'Agência A' },
  { id: 'w2', name: 'Agência B' },
];

function setup(value: TargetValue) {
  const onChange = vi.fn();
  render(<TargetPicker value={value} plans={plans} workspaces={workspaces} onChange={onChange} />);
  return onChange;
}

describe('TargetPicker', () => {
  it('trocar de modo limpa as seleções', () => {
    const onChange = setup({
      target_mode: 'plan',
      target_plan_ids: ['pro'],
      target_workspace_ids: [],
    });
    fireEvent.click(screen.getByLabelText('By Workspace'));
    expect(onChange).toHaveBeenCalledWith({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: [],
    });
  });

  it('modo plan mostra chips de plano e alterna a seleção', () => {
    const onChange = setup({
      target_mode: 'plan',
      target_plan_ids: ['pro'],
      target_workspace_ids: [],
    });
    expect(screen.queryByText('Agência A')).toBeNull();
    fireEvent.click(screen.getByLabelText('Free'));
    expect(onChange).toHaveBeenCalledWith({
      target_mode: 'plan',
      target_plan_ids: ['pro', 'free'],
      target_workspace_ids: [],
    });
    fireEvent.click(screen.getByLabelText('Pro'));
    expect(onChange).toHaveBeenCalledWith({
      target_mode: 'plan',
      target_plan_ids: [],
      target_workspace_ids: [],
    });
  });

  it('modo workspace mostra chips de workspace', () => {
    const onChange = setup({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: [],
    });
    fireEvent.click(screen.getByLabelText('Agência B'));
    expect(onChange).toHaveBeenCalledWith({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: ['w2'],
    });
  });
});
