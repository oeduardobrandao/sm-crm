import { forwardRef } from 'react';
import { Search } from 'lucide-react';
import './entityListPhone.css';

export interface PhoneListSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

/** The search field a phone list header shows under its title once "Buscar" is tapped. */
export const PhoneListSearch = forwardRef<HTMLInputElement, PhoneListSearchProps>(
  function PhoneListSearch({ value, onChange, placeholder }, ref) {
    return (
      <div className="phone-el-search">
        <Search aria-hidden="true" />
        <input
          ref={ref}
          type="search"
          enterKeyHint="search"
          aria-label={placeholder}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  },
);
