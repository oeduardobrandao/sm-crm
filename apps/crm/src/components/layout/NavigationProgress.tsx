import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useIsFetching } from '@tanstack/react-query';

export default function NavigationProgress() {
  const location = useLocation();
  const isFetching = useIsFetching();
  const [state, setState] = useState<'idle' | 'loading' | 'completing'>('idle');
  const prevPathRef = useRef(location.pathname);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (location.pathname !== prevPathRef.current) {
      prevPathRef.current = location.pathname;
      setState('loading');
    }
  }, [location.pathname]);

  useEffect(() => {
    if (isFetching > 0) {
      setState('loading');
      return;
    }

    if (state === 'loading') {
      setState('completing');
      timeoutRef.current = setTimeout(() => setState('idle'), 500);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isFetching, state]);

  const className = [
    'nav-progress-bar',
    state === 'loading' && 'nav-progress-bar--active',
    state === 'completing' && 'nav-progress-bar--completing',
  ].filter(Boolean).join(' ');

  return (
    <div className="nav-progress">
      <div className={className} />
    </div>
  );
}
