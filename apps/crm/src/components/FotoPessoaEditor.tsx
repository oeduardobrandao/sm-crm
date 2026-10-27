import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera } from 'lucide-react';
import { ActionSheet, type ActionSheetAction } from '@/components/mobile/ActionSheet';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useFotoPessoa } from '@/hooks/useFotoPessoa';
import type { FotoAlvo } from '@/store/team';

interface FotoPessoaEditorProps {
  alvo: FotoAlvo;
  nome: string;
  seed?: string | number | null;
  fotoUrl: string | null;
  variant: 'desktop' | 'phone';
  /** Who sees the photo, under the avatar (Perfil uses it). */
  descricao?: string;
}

/**
 * Large avatar with a camera button plus "Alterar foto" / "Remover foto" (with
 * confirmation), for Perfil (self) and the member detail (editors only; the caller
 * decides). Desktop picks a file directly; phone opens an action sheet with gallery,
 * front camera and remove.
 */
export function FotoPessoaEditor({
  alvo,
  nome,
  seed,
  fotoUrl,
  variant,
  descricao,
}: FotoPessoaEditorProps) {
  const { t } = useTranslation();
  const foto = useFotoPessoa(alvo);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const temFoto = !!fotoUrl;
  const acao = temFoto ? t('photo.change') : t('photo.add');
  const cameraLabel = temFoto ? t('photo.changeFor', { nome }) : t('photo.addFor', { nome });

  const avatar = <PessoaAvatar nome={nome} fotoUrl={fotoUrl} seed={seed} size={96} />;
  const inputs = (
    <>
      <input {...foto.inputProps} className="hidden" aria-hidden="true" tabIndex={-1} />
      <input {...foto.cameraInputProps} className="hidden" aria-hidden="true" tabIndex={-1} />
    </>
  );

  if (variant === 'phone') {
    const actions: ActionSheetAction[] = [
      // `immediate`: iOS Safari only opens the file picker inside the tap itself.
      { label: t('photo.gallery'), onSelect: foto.pick, immediate: true },
      { label: t('photo.camera'), onSelect: foto.pickCamera, immediate: true },
    ];
    if (temFoto)
      actions.push({
        label: t('photo.remove'),
        destructive: true,
        onSelect: () => setConfirmOpen(true),
      });

    return (
      <div className="flex flex-col items-center gap-2.5 text-center">
        <button
          type="button"
          className="relative rounded-full disabled:opacity-60"
          aria-label={cameraLabel}
          aria-haspopup="dialog"
          disabled={foto.uploading}
          onClick={() => setSheetOpen(true)}
        >
          {avatar}
          <span
            className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--card-bg)] bg-primary text-primary-foreground"
            aria-hidden="true"
          >
            <Camera size={15} />
          </span>
        </button>
        <button
          type="button"
          className="min-h-11 bg-transparent px-3 text-[15px] font-semibold text-[var(--text-main)] disabled:opacity-60"
          aria-haspopup="dialog"
          disabled={foto.uploading}
          onClick={() => setSheetOpen(true)}
        >
          {acao}
        </button>
        {descricao && <p className="max-w-xs text-[13px] text-muted-foreground">{descricao}</p>}
        {inputs}
        <ActionSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={t('photo.sheetTitle')}
          actions={actions}
        />
        <PhoneConfirmSheet
          open={confirmOpen}
          title={t('photo.removeTitle')}
          message={t('photo.removeDescription')}
          actions={[
            {
              label: t('photo.removeConfirm'),
              destructive: true,
              onSelect: () => {
                setConfirmOpen(false);
                void foto.remove();
              },
            },
          ]}
          onCancel={() => setConfirmOpen(false)}
        />
      </div>
    );
  }

  async function handleRemove() {
    await foto.remove();
    setConfirmOpen(false);
  }

  return (
    <div className="flex items-center gap-6">
      <div className="relative h-24 w-24 shrink-0">
        {avatar}
        <button
          type="button"
          className="absolute -bottom-0.5 -right-0.5 flex h-[34px] w-[34px] items-center justify-center rounded-full border-2 border-[var(--card-bg)] bg-primary p-0 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          aria-label={cameraLabel}
          disabled={foto.uploading}
          onClick={foto.pick}
        >
          <Camera size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        {descricao && (
          <p className="max-w-[380px] text-[13px] text-muted-foreground">{descricao}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={foto.uploading}
            onClick={foto.pick}
          >
            {acao}
          </Button>
          {temFoto && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={foto.uploading}
              onClick={() => setConfirmOpen(true)}
            >
              {t('photo.remove')}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('photo.help')}</p>
      </div>
      {inputs}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('photo.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('photo.removeDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove}>{t('photo.removeConfirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
