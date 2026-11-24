import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Trash2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import {
  HUB_PEOPLE_LIMIT,
  addHubPerson,
  getHubPeople,
  hubPeopleErrorCode,
  hubPeopleKey,
  removeHubPerson,
  setHubRequireLogin,
  type HubPeopleData,
  type HubPerson,
} from '@/store/hubPeople';
import { useHubPortalDataEnabled } from './HubRoleGate';

const addSchema = z.object({
  nome: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
});
type AddValues = z.infer<typeof addSchema>;

// Raw Postgres error text must never reach the user.
function peopleError(e: { message?: string }, t: TFunction<'clientHub'>): string {
  return t(`acesso.people.errors.${hubPeopleErrorCode(e)}`);
}

interface HubPeopleSectionProps {
  clienteId: number;
  clienteNome: string;
  clienteEmail: string | null;
  variant: 'desktop' | 'phone';
}

/** "Quem pode entrar": the people who sign in to this client's Hub, plus "Exigir login". */
export function HubPeopleSection({
  clienteId,
  clienteNome,
  clienteEmail,
  variant,
}: HubPeopleSectionProps) {
  const { t } = useTranslation('clientHub');
  const dateLocale = useDateFnsLocale();
  const qc = useQueryClient();
  const canLoad = useHubPortalDataEnabled();

  const query = useQuery({
    queryKey: hubPeopleKey(clienteId),
    queryFn: () => getHubPeople(clienteId),
    enabled: canLoad,
  });
  const data = query.data;
  const people = data?.people ?? [];
  const requireLogin = data?.require_login ?? false;
  const loaded = data !== undefined;

  const [optimisticRequire, setOptimisticRequire] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<HubPerson | null>(null);
  // Kept after the target clears so the dialog/sheet title does not read "Remover ?"
  // while it animates closed.
  const [removeName, setRemoveName] = useState('');
  const askRemove = (p: HubPerson) => {
    setRemoveName(p.nome);
    setRemoveTarget(p);
  };
  // Saves in flight are invisible to the DOM heuristic of the silent update.
  useUnsavedWork(toggling || adding || removing);

  const form = useForm<AddValues>({
    resolver: zodResolver(addSchema),
    defaultValues: { nome: '', email: '' },
  });

  // defaultValues are read once at mount, before the list arrives. Pre-fill when the list
  // turns out empty, while the form is pristine, and only once: it must not return after
  // the first add clears the row.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !loaded || people.length > 0) return;
    prefilled.current = true;
    if (form.formState.isDirty) return;
    form.reset({ nome: clienteNome, email: clienteEmail ?? '' });
  }, [loaded, people.length, clienteNome, clienteEmail, form]);
  useEffect(() => {
    if (people.length > 0) prefilled.current = true;
  }, [people.length]);

  const switchChecked = optimisticRequire ?? requireLogin;
  const switchDisabled = !loaded || toggling || (people.length === 0 && !switchChecked);
  const limitReached = people.length >= HUB_PEOPLE_LIMIT;

  async function onToggle(next: boolean) {
    setOptimisticRequire(next);
    setToggling(true);
    try {
      await setHubRequireLogin(clienteId, next);
      // Write the saved value first: a failed refetch must not leave a success toast
      // next to a stale switch.
      qc.setQueryData<HubPeopleData>(hubPeopleKey(clienteId), (old) =>
        old ? { ...old, require_login: next } : old,
      );
      await qc.invalidateQueries({ queryKey: hubPeopleKey(clienteId) });
      toast.success(
        next ? t('acesso.people.toast.requireOn') : t('acesso.people.toast.requireOff'),
      );
    } catch (e) {
      toast.error(peopleError(e as { message?: string }, t));
    } finally {
      setOptimisticRequire(null);
      setToggling(false);
    }
  }

  async function onAdd(values: AddValues) {
    if (adding) return;
    setAdding(true);
    try {
      await addHubPerson(clienteId, values.nome, values.email);
      await qc.invalidateQueries({ queryKey: hubPeopleKey(clienteId) });
      prefilled.current = true;
      form.reset({ nome: '', email: '' });
      toast.success(t('acesso.people.toast.added'));
    } catch (e) {
      toast.error(peopleError(e as { message?: string }, t));
    } finally {
      setAdding(false);
    }
  }

  const submit = form.handleSubmit(onAdd, () => toast.error(t('acesso.people.errors.invalid')));

  async function onRemove(person: HubPerson) {
    setRemoveTarget(null);
    setRemoving(true);
    try {
      await removeHubPerson(person.id);
      await qc.invalidateQueries({ queryKey: hubPeopleKey(clienteId) });
      toast.success(t('acesso.people.toast.removed'));
    } catch (e) {
      toast.error(peopleError(e as { message?: string }, t));
    } finally {
      setRemoving(false);
    }
  }

  const lastAccess = (p: HubPerson) =>
    p.last_login_at
      ? t('acesso.people.lastLogin', {
          date: format(new Date(p.last_login_at), t('shared.dateShort'), { locale: dateLocale }),
        })
      : t('acesso.people.neverLoggedIn');

  const helperId = `hub-require-help-${clienteId}`;
  const helper = loaded
    ? switchChecked
      ? t('acesso.people.requireHelp')
      : t('acesso.people.requireOffHelp')
    : undefined;

  if (variant === 'phone') {
    return (
      <div className="phone-cli-acesso__people">
        <GroupedList header={t('acesso.people.title')} headerAs="h3" footer={helper}>
          <Cell
            label={t('acesso.people.requireLabel')}
            disabled={switchDisabled}
            switch={{ checked: switchChecked, onCheckedChange: (v) => void onToggle(v) }}
          />
        </GroupedList>

        {loaded && people.length === 0 && (
          <p className="phone-group__footer">{t('acesso.people.empty')}</p>
        )}
        {people.length > 0 && (
          <GroupedList aria-label={t('acesso.people.title')}>
            {people.map((p) => (
              <Cell
                key={p.id}
                label={p.nome}
                subtitle={p.email}
                value={lastAccess(p)}
                accessory={
                  <button
                    type="button"
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-destructive disabled:opacity-50"
                    aria-label={t('acesso.people.remove', { name: p.nome })}
                    disabled={removing}
                    onClick={() => askRemove(p)}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                }
              />
            ))}
          </GroupedList>
        )}

        {loaded &&
          (limitReached ? (
            <p className="phone-group__footer">{t('acesso.people.errors.limit')}</p>
          ) : (
            <form noValidate onSubmit={(e) => void submit(e)}>
              <GroupedList aria-label={t('acesso.people.add')}>
                <FormRow
                  label={t('acesso.people.nameLabel')}
                  input={{ ...form.register('nome'), autoComplete: 'off', maxLength: 80 }}
                />
                <FormRow
                  label={t('acesso.people.emailLabel')}
                  input={{
                    ...form.register('email'),
                    type: 'email',
                    autoComplete: 'off',
                    autoCapitalize: 'none',
                    inputMode: 'email',
                  }}
                />
                <Cell
                  label={t('acesso.people.add')}
                  icon={<Plus />}
                  disabled={adding || form.formState.isSubmitting}
                  onClick={() => void submit()}
                />
              </GroupedList>
            </form>
          ))}

        <PhoneConfirmSheet
          open={removeTarget !== null}
          title={t('acesso.people.removeTitle', { name: removeName })}
          message={t('acesso.people.removeBody')}
          actions={[
            {
              label: t('acesso.people.removeConfirm'),
              destructive: true,
              onSelect: () => {
                if (removeTarget) void onRemove(removeTarget);
              },
            },
          ]}
          onCancel={() => setRemoveTarget(null)}
        />
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-6">
        <h3 className="font-semibold">{t('acesso.people.title')}</h3>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <Label htmlFor={`hub-require-login-${clienteId}`}>
              {t('acesso.people.requireLabel')}
            </Label>
            <Switch
              id={`hub-require-login-${clienteId}`}
              checked={switchChecked}
              disabled={switchDisabled}
              aria-describedby={helper ? helperId : undefined}
              onCheckedChange={(v) => void onToggle(v)}
            />
          </div>
          {helper && (
            <p id={helperId} className="max-w-md text-right text-xs text-muted-foreground">
              {helper}
            </p>
          )}
        </div>
      </div>

      {loaded && people.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('acesso.people.empty')}</p>
      )}

      {people.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <PessoaAvatar nome={p.nome} seed={p.id} size={36} />
              <div className="flex min-w-0 grow flex-col">
                <span className="truncate font-semibold">{p.nome}</span>
                <span className="truncate text-xs text-muted-foreground">{p.email}</span>
              </div>
              <span className="text-xs text-muted-foreground">{lastAccess(p)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('acesso.people.remove', { name: p.nome })}
                disabled={removing}
                onClick={() => askRemove(p)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {loaded &&
        (limitReached ? (
          <p className="text-sm text-muted-foreground">{t('acesso.people.errors.limit')}</p>
        ) : (
          <form
            noValidate
            onSubmit={(e) => void submit(e)}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
              <Label htmlFor={`hub-person-nome-${clienteId}`}>{t('acesso.people.nameLabel')}</Label>
              <Input
                id={`hub-person-nome-${clienteId}`}
                autoComplete="off"
                maxLength={80}
                {...form.register('nome')}
              />
            </div>
            <div className="flex min-w-[14rem] flex-[1.2] flex-col gap-1.5">
              <Label htmlFor={`hub-person-email-${clienteId}`}>
                {t('acesso.people.emailLabel')}
              </Label>
              <Input
                id={`hub-person-email-${clienteId}`}
                type="email"
                autoComplete="off"
                {...form.register('email')}
              />
            </div>
            <Button type="submit" disabled={adding || form.formState.isSubmitting}>
              {t('acesso.people.add')}
            </Button>
          </form>
        ))}

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('acesso.people.removeTitle', { name: removeName })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('acesso.people.removeBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removeTarget) void onRemove(removeTarget);
              }}
            >
              {t('acesso.people.removeConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
