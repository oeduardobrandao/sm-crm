import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { captureEvent } from '@/lib/analytics';
import { ADD_CARD_PATH } from '@/lib/reverseTrial';
import { isNativeApp } from '@/native/platform';

/**
 * Banner on Financeiro and Contratos while they are read-only after a reverse trial. The owner
 * gets "Recuperar o Pro"; inside the iOS app it is text only.
 */
export function ReadOnlyNotice({ className }: { className?: string }) {
  const { t } = useTranslation('billing');
  const { role, workspaceRole } = useAuth();
  const isOwner = (workspaceRole ?? role) === 'owner';
  const native = isNativeApp();
  return (
    <div role="status" className={`read-only-notice${className ? ` ${className}` : ''}`}>
      <Lock size={16} aria-hidden="true" />
      <p className="read-only-notice__text">
        {native ? t('reverseTrial.readOnly.nativeNotice') : t('reverseTrial.readOnly.notice')}
      </p>
      {isOwner && !native && (
        <Link
          to={ADD_CARD_PATH}
          className="btn-primary"
          onClick={() => captureEvent('reverse_trial_add_card_clicked', { surface: 'read_only' })}
        >
          {t('reverseTrial.readOnly.cta')}
        </Link>
      )}
    </div>
  );
}
