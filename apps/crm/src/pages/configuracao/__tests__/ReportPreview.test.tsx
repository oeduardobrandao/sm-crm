import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReportPreview } from '../ReportPreview';

describe('ReportPreview v2', () => {
  it('renders workspace name, accent chip and splash when provided', () => {
    render(
      <ReportPreview
        accentColor="#7C2D12"
        splashUrl="https://x/y.jpg"
        logoUrl={null}
        workspaceName="Agência Teste"
      />,
    );
    expect(screen.getByText('Agência Teste')).toBeInTheDocument();
    expect(screen.getByTestId('preview-splash')).toHaveAttribute('src', 'https://x/y.jpg');
    expect(screen.getByTestId('preview-rank-chip')).toHaveStyle({ backgroundColor: '#7C2D12' });
  });

  it('typographic cover without splash; note about illustrative fonts', () => {
    render(
      <ReportPreview accentColor="#171717" splashUrl={null} logoUrl={null} workspaceName="A" />,
    );
    expect(screen.queryByTestId('preview-splash')).not.toBeInTheDocument();
    expect(screen.getByText(/fontes ilustrativas/i)).toBeInTheDocument();
  });

  it('renders logo plate when logoUrl is provided', () => {
    render(
      <ReportPreview
        accentColor="#42c8f5"
        splashUrl={null}
        logoUrl="https://x/logo.png"
        workspaceName="Agência Logo"
      />,
    );
    expect(screen.getByTestId('preview-logo')).toHaveAttribute('src', 'https://x/logo.png');
  });

  it('does not tint chart/KPI marks with the accent colour', () => {
    render(
      <ReportPreview
        accentColor="#ff00ff"
        splashUrl={null}
        logoUrl={null}
        workspaceName="Agência Sem Tint"
      />,
    );
    const kpiRow = screen.getByTestId('preview-kpi-row');
    const kpiValues = kpiRow.querySelectorAll('[data-testid="preview-kpi-value"]');
    expect(kpiValues.length).toBeGreaterThan(0);
    kpiValues.forEach((el) => {
      expect((el as HTMLElement).style.color).not.toBe('rgb(255, 0, 255)');
      expect((el as HTMLElement).style.backgroundColor).not.toBe('rgb(255, 0, 255)');
    });
  });
});
