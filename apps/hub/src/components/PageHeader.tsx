import { useContext, type ReactNode } from 'react';
import { HubContext } from '../HubContext';
import { useHubLook } from '../hooks/useHubLook';

/**
 * The portal's one page header: display title, a one-line description, and an
 * optional action aligned to the title. Every page renders through this so the
 * type scale and spacing can't drift apart again — they had, with headings
 * split across h1/h2 at two sizes and four pages carrying no description.
 */
export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Pauta only. Defaults to the client's name. */
  eyebrow?: ReactNode;
}) {
  const pauta = useHubLook() === 'pauta';
  const clienteNome = useContext(HubContext)?.bootstrap?.cliente_nome;
  const eyebrowNode = pauta ? (eyebrow ?? clienteNome) : null;
  return (
    <header className="mb-8">
      {eyebrowNode ? <div className="hub-eyebrow mb-2.5">{eyebrowNode}</div> : null}
      <div className="flex items-center justify-between gap-4">
        <h2
          className={
            pauta
              ? 'font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] hub-display-title tracking-tight hub-txt'
              : 'font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] font-medium tracking-tight hub-txt'
          }
        >
          {title}
        </h2>
        {action}
      </div>
      {description && <p className="text-[14px] hub-tx2 mt-2">{description}</p>}
    </header>
  );
}
