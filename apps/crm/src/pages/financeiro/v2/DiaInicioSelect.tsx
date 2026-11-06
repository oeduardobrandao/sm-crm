import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const DIAS = Array.from({ length: 28 }, (_, i) => i + 1);

/** Day of the month (1..28) a financial period starts on. Name it with `<Label htmlFor={id}>`. */
export function DiaInicioSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: number;
  onChange: (dia: number) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))} disabled={disabled}>
      <SelectTrigger id={id} className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DIAS.map((d) => (
          <SelectItem key={d} value={String(d)}>
            {d}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
