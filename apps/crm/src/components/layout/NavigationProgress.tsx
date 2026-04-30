import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

export default function NavigationProgress() {
  const location = useLocation();
  const [state, setState] = useState<'idle' | 'loading' | 'completing' | 'fading'>('idle');
  const prevPathRef = useRef(location.pathname);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (location.pathname !== prevPathRef.current) {
      prevPathRef.current = location.pathname;
      setState('loading');

      timeoutRef.current = setTimeout(() => {
        setState('completing');
        setTimeout(() => setState('fading'), 200);
        setTimeout(() => setState('idle'), 600);
      }, 400);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [location.pathname]);

  if (state === 'idle') return null;

  const className = [
    'nav-progress-bar',
    state === 'loading' && 'nav-progress-bar--active',
    (state === 'completing' || state === 'fading') && 'nav-progress-bar--completing',
    state === 'fading' && 'nav-progress-bar--fade',
  ].filter(Boolean).join(' ');

  return (
    <div className="nav-progress">
      <div className={className} />
    </div>
  );
}
