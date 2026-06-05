import React from 'react';
import { Info } from 'lucide-react';
import { Link } from 'react-router-dom';

interface PrerequisiteAlertProps {
  title: string;
  description: React.ReactNode;
  actionLabel: string;
  actionHref: string;
}

export function PrerequisiteAlert({
  title,
  description,
  actionLabel,
  actionHref,
}: PrerequisiteAlertProps) {
  return (
    <div className="flex gap-3 bg-[#eff6ff] border border-[#bfdbfe] rounded-[10px] px-4 py-3">
      <Info className="h-4 w-4 text-[#3b82f6] shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1">
        <span className="text-[#1e40af] font-semibold text-sm">{title}</span>
        <p className="text-[#3b82f6] text-xs">
          {description}{' '}
          <Link to={actionHref} className="text-[#1e40af] underline font-medium">
            {actionLabel}
          </Link>
        </p>
      </div>
    </div>
  );
}
