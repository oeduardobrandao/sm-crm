import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createDesign, getClientes } from '@/store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const FORMATS = ['feed', 'carrossel', 'reel_cover', 'livre'] as const;
type Format = (typeof FORMATS)[number];

// Little aspect-ratio silhouettes for the format tiles (livre = dashed free canvas).
const TILE_ASPECT: Record<Format, string> = {
  feed: '4 / 5',
  carrossel: '4 / 5',
  reel_cover: '9 / 16',
  livre: '1 / 1',
};

export function NewDesignDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation('estudio');
  const [format, setFormat] = useState<Format>('feed');
  const [clienteId, setClienteId] = useState<number | undefined>(undefined);
  const [name, setName] = useState('');

  const clientesQuery = useQuery({ queryKey: ['clientes'], queryFn: getClientes });

  const createMutation = useMutation({
    mutationFn: () =>
      createDesign({
        format,
        ...(clienteId !== undefined ? { cliente_id: clienteId } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
      }),
    onSuccess: ({ design_id }) => {
      onOpenChange(false);
      navigate(`/estudio/${design_id}`);
    },
    onError: (err: Error) => toast.error(t('toast.createError', { error: err.message })),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 480 }}>
        <DialogHeader>
          <DialogTitle>{t('home.newDesign')}</DialogTitle>
          <DialogDescription>{t('home.newDesignHint')}</DialogDescription>
        </DialogHeader>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '0.6rem',
            marginBottom: '0.75rem',
          }}
        >
          {FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              data-testid={`format-${f}`}
              onClick={() => setFormat(f)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.6rem 0.3rem',
                borderRadius: 10,
                border:
                  format === f ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                background: format === f ? 'rgba(234,179,8,0.08)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  width: 26,
                  aspectRatio: TILE_ASPECT[f],
                  maxHeight: 44,
                  borderRadius: 3,
                  border:
                    f === 'livre'
                      ? '1.5px dashed var(--text-light)'
                      : '1.5px solid var(--text-light)',
                }}
              />
              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-main)' }}>
                {t(`home.formats.${f}`)}
              </span>
              <span style={{ fontSize: '0.6rem', color: 'var(--text-light)' }}>
                {t(`home.formatHints.${f}`)}
              </span>
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div>
            <label
              style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              {t('home.clientLabel')}
            </label>
            <Select
              value={clienteId === undefined ? 'none' : String(clienteId)}
              onValueChange={(v) => setClienteId(v === 'none' ? undefined : parseInt(v, 10))}
            >
              <SelectTrigger data-testid="new-design-client">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('home.noClient')}</SelectItem>
                {(clientesQuery.data ?? [])
                  .filter((c) => c.id !== undefined)
                  .map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label
              style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              {t('home.nameLabel')}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('home.namePlaceholder')}
              data-testid="new-design-name"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
            data-testid="new-design-create"
          >
            {createMutation.isPending ? t('picker.creating') : t('home.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
