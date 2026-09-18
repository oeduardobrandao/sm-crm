import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusTag } from '../StatusTag';

describe('StatusTag', () => {
  it('renders the client-facing label as plain text, without a leading dot element', () => {
    const { container } = render(<StatusTag status="enviado_cliente" />);
    const pill = screen.getByText('Aguardando aprovação');
    expect(pill).toBeInTheDocument();
    expect(pill.children).toHaveLength(0);
    expect(container.querySelector('span span')).toBeNull();
  });

  it('keeps the size prop: md is larger than sm', () => {
    const { rerender } = render(<StatusTag status="aprovado_cliente" size="sm" />);
    const sm = screen.getByText('Aprovado').style.fontSize;
    rerender(<StatusTag status="aprovado_cliente" size="md" />);
    const md = screen.getByText('Aprovado').style.fontSize;
    expect(sm).toBe('0.65rem');
    expect(md).toBe('0.72rem');
  });

  it('uses a squared 4px corner, not the round pill or the theme radius', () => {
    render(<StatusTag status="enviado_cliente" />);
    const cls = screen.getByText('Aguardando aprovação').className;
    expect(cls).toContain('rounded-[4px]');
    expect(cls).not.toContain('rounded-full');
  });
});
