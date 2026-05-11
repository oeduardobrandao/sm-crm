import React from "react"
import { Link } from "react-router"

interface EmptyStateGuideProps {
  icon: React.ReactNode
  title: string
  description: React.ReactNode
  actionLabel: string
  actionHref: string
  hint?: string
}

export function EmptyStateGuide({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
  hint,
}: EmptyStateGuideProps) {
  return (
    <div className="border border-dashed border-[#d4a017] bg-[rgba(234,179,8,0.06)] rounded-xl px-4 py-5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <span className="font-semibold text-amber-900 text-sm">{title}</span>
      </div>
      <p className="text-stone-500 text-sm">
        {description}{" "}
        <Link to={actionHref} className="text-[#eab308] font-semibold underline">
          {actionLabel}
        </Link>
      </p>
      {hint && <p className="text-stone-400 text-xs">{hint}</p>}
    </div>
  )
}
