import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { SectionHeader } from '../../components/SectionHeader';

export function ResourcesSection({
  number,
  base,
  links,
}: {
  number: number;
  base: string;
  links: { labelKey: string; label: string; icon: LucideIcon; path: string }[];
}) {
  const { t } = useTranslation('hubHome');
  const navigate = useNavigate();
  return (
    <section className="hub-card p-5">
      <SectionHeader
        number={number}
        label={t('home.pauta.section.resources', 'Recursos')}
        title={t('home.pauta.resources.title', 'Acesso rápido')}
      />
      <div className="hub-divide">
        {links.map(({ labelKey, label, icon: Icon, path }) => (
          <button
            key={path}
            type="button"
            onClick={() => navigate(`${base}${path}`)}
            className="w-full flex items-center gap-3 py-2.5 text-left group"
          >
            <span className="w-8 h-8 rounded-[var(--hub-r-tile)] hub-bg-soft flex items-center justify-center hub-tx2 shrink-0">
              <Icon size={16} strokeWidth={1.75} />
            </span>
            <span className="flex-1 text-[14px] font-medium hub-txt">{t(labelKey, label)}</span>
            <ChevronRight
              size={14}
              className="hub-tx3 group-hover:translate-x-0.5 transition-transform"
            />
          </button>
        ))}
      </div>
    </section>
  );
}
