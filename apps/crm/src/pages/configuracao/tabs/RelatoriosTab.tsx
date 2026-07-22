import { useEffect, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '../../../context/AuthContext';
import { getWorkspaceBranding, updateWorkspaceBranding } from '../../../store';
import { ReportPreview } from '../ReportPreview';

const COLOR_SWATCH: CSSProperties = {
  width: 48,
  height: 36,
  padding: 2,
  borderRadius: 6,
  border: '1px solid var(--border-color)',
  cursor: 'pointer',
  background: 'none',
};

const COLOR_VALUE: CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--text-muted)',
  marginTop: 4,
  fontFamily: 'var(--font-mono)',
};

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label style={{ display: 'block', marginBottom: 6 }}>{label}</Label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={COLOR_SWATCH}
      />
      <div style={COLOR_VALUE}>{value}</div>
    </div>
  );
}

/** Branding for the monthly client report, with a live preview. */
export default function RelatoriosTab() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const { data: branding } = useQuery({
    queryKey: ['workspace-branding'],
    queryFn: getWorkspaceBranding,
    enabled: isOwnerOrAdmin,
  });

  const [brandColor, setBrandColor] = useState('#eab308');
  const [secondaryColor, setSecondaryColor] = useState('#3ecf8e');
  const [accentColor, setAccentColor] = useState('#42c8f5');
  const [reportFont, setReportFont] = useState('DM Sans');
  const [reportTheme, setReportTheme] = useState<'dark' | 'light'>('dark');
  const [sendReportEmail, setSendReportEmail] = useState(false);

  useEffect(() => {
    if (branding) {
      setBrandColor(branding.brand_color ?? '#eab308');
      setSecondaryColor(branding.report_secondary_color ?? '#3ecf8e');
      setAccentColor(branding.report_accent_color ?? '#42c8f5');
      setReportFont(branding.report_font_family ?? 'DM Sans');
      setReportTheme((branding.report_theme as 'dark' | 'light') ?? 'dark');
      setSendReportEmail(branding.send_report_email ?? false);
    }
  }, [branding]);

  const brandingMutation = useMutation({
    mutationFn: () =>
      updateWorkspaceBranding({
        brand_color: brandColor,
        report_secondary_color: secondaryColor,
        report_accent_color: accentColor,
        report_font_family: reportFont,
        report_theme: reportTheme,
        send_report_email: sendReportEmail,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-branding'] });
      toast.success('Configurações de relatório salvas!');
    },
    onError: (err: unknown) => {
      toast.error('Erro ao salvar: ' + (err as Error).message);
    },
  });

  return (
    <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
      <h3 className="config-title">Relatório Mensal</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
        Personalize as cores, fonte e tema dos relatórios mensais enviados para seus clientes.
      </p>

      <div className="config-report-grid">
        <div>
          <div
            style={{
              display: 'flex',
              gap: '1.5rem',
              flexWrap: 'wrap',
              marginBottom: '1.25rem',
            }}
          >
            <ColorField label="Cor primária" value={brandColor} onChange={setBrandColor} />
            <ColorField
              label="Cor secundária"
              value={secondaryColor}
              onChange={setSecondaryColor}
            />
            <ColorField label="Cor de destaque" value={accentColor} onChange={setAccentColor} />
          </div>

          {/* Font selector */}
          <div style={{ marginBottom: '1.25rem' }}>
            <Label style={{ display: 'block', marginBottom: 6 }}>Fonte do relatório</Label>
            <Select value={reportFont} onValueChange={setReportFont}>
              <SelectTrigger style={{ maxWidth: 260 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DM Sans">DM Sans</SelectItem>
                <SelectItem value="Inter">Inter</SelectItem>
                <SelectItem value="Poppins">Poppins</SelectItem>
                <SelectItem value="Montserrat">Montserrat</SelectItem>
                <SelectItem value="Plus Jakarta Sans">Plus Jakarta Sans</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Theme toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              marginBottom: '1.25rem',
            }}
          >
            <Switch
              checked={reportTheme === 'dark'}
              onCheckedChange={(checked) => setReportTheme(checked ? 'dark' : 'light')}
            />
            <div>
              <div style={{ fontWeight: 500 }}>Tema do relatório</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {reportTheme === 'dark' ? 'Escuro' : 'Claro'}
              </div>
            </div>
          </div>

          {/* Email delivery toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            <Switch checked={sendReportEmail} onCheckedChange={setSendReportEmail} />
            <div>
              <div style={{ fontWeight: 500 }}>Enviar relatórios por e-mail</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Quando ativado, relatórios mensais serão enviados automaticamente para clientes
                habilitados.
              </div>
            </div>
          </div>

          <Button onClick={() => brandingMutation.mutate()} disabled={brandingMutation.isPending}>
            {brandingMutation.isPending && <Spinner size="sm" />} Salvar
          </Button>
        </div>

        {/* Live preview */}
        <ReportPreview
          primaryColor={brandColor}
          secondaryColor={secondaryColor}
          accentColor={accentColor}
          fontFamily={reportFont}
          theme={reportTheme}
        />
      </div>
    </div>
  );
}
