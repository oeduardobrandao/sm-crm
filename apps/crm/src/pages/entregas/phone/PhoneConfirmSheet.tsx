import './entregasPhone.css';

// The confirm sheet moved to the phone kit (PLAN F0b.3); Entregas keeps importing it
// from here. ChoiceLabel stays: its styles are Entregas' own.
export { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
export type { PhoneConfirmSheetProps } from '@/components/mobile/PhoneConfirmSheet';

/** Two-line action label (choice + what it does), as in the approval choice. */
export function ChoiceLabel({ title, description }: { title: string; description: string }) {
  return (
    <span className="phone-ent-choice">
      <span className="phone-ent-choice__title">{title}</span>
      <span className="phone-ent-choice__desc">{description}</span>
    </span>
  );
}
