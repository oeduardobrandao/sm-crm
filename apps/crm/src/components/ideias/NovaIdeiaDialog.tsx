import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mic, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { AudioPlayer } from '@mesaas/ui/AudioPlayer';
import { AudioRecorder, isRecordingSupported, type RecorderPhase } from '@mesaas/ui/AudioRecorder';
import { describeAudioError } from '@mesaas/ui/audio/validation';
import { createIdeia, updateIdeia, getClientes, type Ideia } from '@/store';
import { uploadIdeiaAudio } from '@/services/ideiaAudio';
import { useCurrentMembro } from '@/hooks/useCurrentMembro';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { CRM_AUDIO_VARS } from '@/lib/audioVars';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function isAbsoluteHttp(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Built per render language: zod messages are resolved when the schema is created.
function buildSchema(t: TFunction) {
  return z.object({
    cliente_id: z.string().min(1, t('novaIdeiaDialog.clientRequired')),
    titulo: z
      .string()
      .trim()
      .min(1, t('novaIdeiaDialog.titleRequired'))
      .max(200, t('novaIdeiaDialog.titleMax')),
    // Optional: the idea can be conveyed entirely through the audio recording instead.
    // onSubmit below still requires at least one of descricao/pendingAudio -- that check
    // needs the recorder's local state, which zod's schema can't see.
    descricao: z.string().trim(),
    links: z.array(
      z.object({
        value: z
          .string()
          .trim()
          .refine((v) => v === '' || isAbsoluteHttp(v), t('novaIdeiaDialog.linkInvalid')),
      }),
    ),
    visivel_no_hub: z.boolean(),
  });
}
type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface PendingAudio {
  blob: Blob;
  mime: string;
  durationSeconds: number;
  url: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (ideiaId: string) => void;
  /** Agency-created ideia being edited, or null/omitted to create a new one. */
  editing?: Ideia | null;
}

export function NovaIdeiaDialog({ open, onClose, onSaved, editing = null }: Props) {
  const qc = useQueryClient();
  const { t } = useTranslation('ideaDrawer');
  const schema = useMemo(() => buildSchema(t), [t]);
  const { membro } = useCurrentMembro();
  const { features } = useWorkspaceLimits();
  const audioAllowed = features?.feature_briefing_audio === true && isRecordingSupported();

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const sortedClientes = [...clientes].sort((a: any, b: any) =>
    a.nome.localeCompare(b.nome, 'pt-BR'),
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      cliente_id: '',
      titulo: '',
      descricao: '',
      links: [{ value: '' }],
      visivel_no_hub: false,
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'links' });

  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [rerecord, setRerecord] = useState(false);
  const [audioPhase, setAudioPhase] = useState<RecorderPhase>('idle');
  const [submitting, setSubmitting] = useState(false);

  useEffect(
    () => () => {
      if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
    },
    [pendingAudio],
  );

  function discardAudio() {
    if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
    setPendingAudio(null);
    setRerecord(false);
  }

  // Populates the form from `editing` (or blanks it for a fresh create) every time the
  // dialog opens. The component stays mounted between opens -- react-hook-form's
  // `defaultValues` only apply once at mount, so without this a second "Nova ideia"
  // would show whatever was left over from the previous open, and switching between
  // editing two different ideias wouldn't update the fields at all.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.reset({
        cliente_id: String(editing.cliente_id),
        titulo: editing.titulo,
        descricao: editing.descricao ?? '',
        links: editing.links.length ? editing.links.map((value) => ({ value })) : [{ value: '' }],
        visivel_no_hub: editing.visivel_no_hub,
      });
    } else {
      form.reset({
        cliente_id: '',
        titulo: '',
        descricao: '',
        links: [{ value: '' }],
        visivel_no_hub: false,
      });
    }
    discardAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  async function onSubmit(values: FormValues) {
    // While `rerecord` is true, the recorder shown is empty (the user asked to replace
    // the take) even though `pendingAudio` still holds the OLD blob until a new one is
    // confirmed. Treat that stale blob as "no audio" here, for both the guard and the
    // actual upload below -- otherwise submitting mid-rerecord silently uploads the
    // take the user is in the middle of discarding, despite an empty recorder on screen.
    // Editing never re-records audio here (no recorder shown) -- an ideia already
    // carrying audio still satisfies the guard even with descricao cleared.
    const audioToUpload = !editing && pendingAudio && !rerecord ? pendingAudio : null;
    const hasExistingAudio = !!editing?.audio_r2_key;
    if (!values.descricao.trim() && !audioToUpload && !hasExistingAudio) {
      form.setError('descricao', {
        message: audioAllowed
          ? t('novaIdeiaDialog.descriptionOrAudio')
          : t('novaIdeiaDialog.descriptionRequired'),
      });
      return;
    }
    setSubmitting(true);
    try {
      const links = values.links.map((l) => l.value.trim()).filter(Boolean);

      if (editing) {
        await updateIdeia(editing.id, {
          cliente_id: parseInt(values.cliente_id, 10),
          titulo: values.titulo.trim(),
          descricao: values.descricao.trim() || null,
          links,
          visivel_no_hub: values.visivel_no_hub,
        });
        qc.invalidateQueries({ queryKey: ['hub-ideias-all'] });
        qc.invalidateQueries({ queryKey: ['ideias'] });
        toast.success(t('novaIdeiaDialog.toastUpdated'));
        form.reset();
        onSaved(editing.id);
        return;
      }

      const id = await createIdeia({
        cliente_id: parseInt(values.cliente_id, 10),
        titulo: values.titulo.trim(),
        descricao: values.descricao.trim() || null,
        links,
        visivel_no_hub: values.visivel_no_hub,
        autor_membro_id: membro?.id ?? null,
      });
      let audioOk = true;
      if (audioToUpload) {
        try {
          await uploadIdeiaAudio({
            ideiaId: id,
            blob: audioToUpload.blob,
            mime: audioToUpload.mime,
            durationSeconds: audioToUpload.durationSeconds,
            onPhase: setAudioPhase,
          });
        } catch (e) {
          audioOk = false;
          // The blob is gone by the time the user reads this (discarded below,
          // same as the success path) -- when there's no descricao either, the
          // ideia was just created with no content at all, so say so plainly and
          // point at the drawer's own recorder, which still works for a
          // no-audio ideia, rather than implying "tentar de novo" replays
          // anything.
          toast.warning(
            describeAudioError(
              e,
              values.descricao.trim()
                ? t('novaIdeiaDialog.audioFailed')
                : t('novaIdeiaDialog.audioFailedNoContent'),
            ),
          );
        } finally {
          setAudioPhase('idle');
        }
      }
      qc.invalidateQueries({ queryKey: ['hub-ideias-all'] });
      qc.invalidateQueries({ queryKey: ['ideias'] });
      if (audioOk) toast.success(t('novaIdeiaDialog.toastCreated'));
      form.reset();
      discardAudio();
      onSaved(id);
    } catch (e: any) {
      toast.error(
        e.message ?? (editing ? t('novaIdeiaDialog.errorSave') : t('novaIdeiaDialog.errorCreate')),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = editing
    ? t('novaIdeiaDialog.saveChanges')
    : audioPhase === 'uploading'
      ? t('novaIdeiaDialog.uploadingAudio')
      : audioPhase === 'transcribing'
        ? t('novaIdeiaDialog.transcribing')
        : t('novaIdeiaDialog.create');

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {editing ? t('novaIdeiaDialog.editTitle') : t('novaIdeiaDialog.newTitle')}
          </DialogTitle>
          <DialogDescription>
            {editing ? t('novaIdeiaDialog.editDescription') : t('novaIdeiaDialog.newDescription')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="nova-ideia-cliente">{t('novaIdeiaDialog.client')}</Label>
              <Controller
                control={form.control}
                name="cliente_id"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="nova-ideia-cliente" aria-label={t('novaIdeiaDialog.client')}>
                      <SelectValue placeholder={t('novaIdeiaDialog.selectClient')} />
                    </SelectTrigger>
                    <SelectContent>
                      {sortedClientes.map((c: any) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {form.formState.errors.cliente_id && (
                <p className="text-xs text-[var(--danger-text)]">
                  {form.formState.errors.cliente_id.message}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="nova-ideia-titulo">{t('novaIdeiaDialog.title')}</Label>
              <Input
                id="nova-ideia-titulo"
                {...form.register('titulo')}
                placeholder={t('novaIdeiaDialog.titlePlaceholder')}
              />
              {form.formState.errors.titulo && (
                <p className="text-xs text-[var(--danger-text)]">
                  {form.formState.errors.titulo.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="nova-ideia-descricao">
              {t('shared.description')}
              {audioAllowed && !editing && (
                <span className="font-normal text-muted-foreground">
                  {' '}
                  {t('novaIdeiaDialog.orRecordAudio')}
                </span>
              )}
            </Label>
            <Textarea
              id="nova-ideia-descricao"
              {...form.register('descricao')}
              className="min-h-[64px]"
              placeholder={t('novaIdeiaDialog.descriptionPlaceholder')}
            />
            {form.formState.errors.descricao && (
              <p className="text-xs text-[var(--danger-text)]">
                {form.formState.errors.descricao.message}
              </p>
            )}
          </div>

          {audioAllowed && !editing && (
            <div className="space-y-1.5" style={CRM_AUDIO_VARS}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('novaIdeiaDialog.audio')}{' '}
                <span className="ml-1 normal-case font-normal tracking-normal">
                  {t('novaIdeiaDialog.orWriteDescription')}
                </span>
              </p>
              {pendingAudio && !rerecord ? (
                <div className="space-y-2">
                  <AudioPlayer
                    src={pendingAudio.url}
                    durationSeconds={pendingAudio.durationSeconds}
                    label={t('novaIdeiaDialog.preview')}
                    className="w-full max-w-[360px] text-foreground"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRerecord(true)}
                    >
                      <Mic size={13} className="mr-1.5" /> {t('shared.recordAgain')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={discardAudio}>
                      {t('novaIdeiaDialog.discard')}
                    </Button>
                  </div>
                </div>
              ) : (
                <AudioRecorder
                  phase={audioPhase}
                  disabled={submitting}
                  sendLabel={t('novaIdeiaDialog.useThisAudio')}
                  hint={t('novaIdeiaDialog.recorderHint')}
                  onRecorded={async (blob, mime, durationSeconds) => {
                    if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
                    setPendingAudio({
                      blob,
                      mime,
                      durationSeconds,
                      url: URL.createObjectURL(blob),
                    });
                    setRerecord(false);
                  }}
                />
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label>{t('shared.referenceLinks')}</Label>
            {fields.map((f, i) => (
              <div key={f.id} className="space-y-1">
                <div className="flex gap-2">
                  <Input {...form.register(`links.${i}.value`)} placeholder="https://" />
                  {fields.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('novaIdeiaDialog.removeLink')}
                      onClick={() => remove(i)}
                    >
                      <X size={14} />
                    </Button>
                  )}
                </div>
                {form.formState.errors.links?.[i]?.value && (
                  <p className="text-xs text-[var(--danger-text)]">
                    {form.formState.errors.links[i]?.value?.message}
                  </p>
                )}
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={() => append({ value: '' })}>
              <Plus size={13} className="mr-1" /> {t('novaIdeiaDialog.addLink')}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t('shared.clientHubVisible')}</p>
              <p className="text-xs text-muted-foreground">{t('novaIdeiaDialog.hubHint')}</p>
            </div>
            <Controller
              control={form.control}
              name="visivel_no_hub"
              render={({ field }) => (
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-label={t('shared.clientHubVisible')}
                />
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 size={13} className="animate-spin mr-1.5" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
