import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { avatarColorClass } from '@/lib/avatarColor';
import { getInitials } from '@/lib/initials';

export interface PessoaEquipe {
  /** auth uid (getWorkspaceUsers().id = profiles.id = auth.users.id). */
  id: string;
  nome: string;
  avatar_url?: string | null;
}

interface PessoasComboboxProps {
  pessoas: PessoaEquipe[];
  value: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  disabled?: boolean;
}

const AVATAR = { width: 22, height: 22, fontSize: 10, flexShrink: 0 } as const;

function Avatar({ pessoa }: { pessoa: PessoaEquipe }) {
  if (pessoa.avatar_url) {
    return (
      <img
        src={pessoa.avatar_url}
        alt=""
        className="avatar"
        style={{ ...AVATAR, objectFit: 'cover' }}
      />
    );
  }
  return (
    <span className={`avatar ${avatarColorClass(pessoa.id)}`} style={AVATAR} aria-hidden="true">
      {getInitials(pessoa.nome)}
    </span>
  );
}

/** Multi-select of team members as avatar chips plus a searchable list
 *  (Popover + cmdk). Ids are auth uids. */
export function PessoasCombobox({ pessoas, value, onChange, max, disabled }: PessoasComboboxProps) {
  const [aberto, setAberto] = useState(false);
  const porId = useMemo(() => new Map(pessoas.map((p) => [p.id, p])), [pessoas]);
  const disponiveis = useMemo(
    () =>
      pessoas
        .filter((p) => !value.includes(p.id))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [pessoas, value],
  );
  const cheio = max !== undefined && value.length >= max;

  return (
    <div
      className="flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-[10px] border px-2 py-1.5"
      style={{ borderColor: 'var(--border-color)', background: 'var(--card-bg)' }}
    >
      {value.map((id) => {
        const p = porId.get(id) ?? { id, nome: 'Pessoa da equipe' };
        return (
          <span
            key={id}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-full pl-1 pr-2 text-[13px]"
            style={{ background: 'var(--surface-2)' }}
          >
            <Avatar pessoa={p} />
            {p.nome}
            <button
              type="button"
              aria-label={`Remover ${p.nome}`}
              disabled={disabled}
              onClick={() => onChange(value.filter((v) => v !== id))}
              className="rounded px-0.5"
              style={{ color: 'var(--text-muted)' }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        );
      })}
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled || cheio}
            className="inline-flex h-[30px] items-center gap-1 rounded-md px-1.5 text-sm disabled:opacity-50"
            style={{ color: 'var(--text-light)' }}
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar pessoa da equipe
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar pessoa" />
            <CommandList>
              <CommandEmpty>Ninguém encontrado.</CommandEmpty>
              <CommandGroup>
                {disponiveis.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`${p.nome} ${p.id}`}
                    onSelect={() => {
                      onChange([...value, p.id]);
                      if (max !== undefined && value.length + 1 >= max) setAberto(false);
                    }}
                    className="gap-2"
                  >
                    <Avatar pessoa={p} />
                    {p.nome}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
