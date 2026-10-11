import { useRef, useState, type Ref } from 'react';
import { Search, X } from 'lucide-react';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import './phoneCrud.css';

/**
 * The "Buscar" round button of a phone page header and the search field it reveals
 * under the large title. Open from the start when the page already has a query; closing
 * clears it, so a hidden field never filters the list.
 */
export function usePhoneSearch(search: string, onSearchChange: (value: string) => void) {
  const [open, setOpen] = useState(() => search !== '');
  const inputRef = useRef<HTMLInputElement>(null);

  const button = (
    <PhoneIconButton
      label={open ? 'Fechar busca' : 'Buscar'}
      aria-expanded={open}
      onClick={() => {
        if (open) {
          onSearchChange('');
          setOpen(false);
        } else {
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      }}
    >
      {open ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
    </PhoneIconButton>
  );

  return { open, button, inputRef };
}

export function PhoneSearchField({
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="phone-crud-search">
      <Search aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
