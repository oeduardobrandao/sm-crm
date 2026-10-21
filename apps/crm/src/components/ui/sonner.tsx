import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Bottom offsets that clear the phone's floating tab bar. `--phone-toast-offset` is set
 * in style.css only below 768px while the CRM shell shows the tab bar, so everywhere else
 * (desktop, tablet, login, landing) the fallback is sonner's own default (24px, and 16px
 * under its 600px mobile breakpoint). Both props are needed: sonner switches to
 * `mobileOffset` at 600px, and phones reach 767px.
 */
export const TOASTER_OFFSET = { bottom: 'var(--phone-toast-offset, 24px)' } as const;
export const TOASTER_MOBILE_OFFSET = { bottom: 'var(--phone-toast-offset, 16px)' } as const;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      offset={TOASTER_OFFSET}
      mobileOffset={TOASTER_MOBILE_OFFSET}
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
