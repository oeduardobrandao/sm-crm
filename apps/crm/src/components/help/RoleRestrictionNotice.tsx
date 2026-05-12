import React from "react"
import { Lock } from "lucide-react"

interface RoleRestrictionNoticeProps {
  title: string
  description: string
}

export function RoleRestrictionNotice({ title, description }: RoleRestrictionNoticeProps) {
  return (
    <div className="bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl p-4 flex flex-col items-center gap-2 text-center">
      <Lock className="h-4 w-4 text-stone-400 dark:text-stone-500" />
      <div className="flex flex-col gap-1">
        <span className="text-stone-500 dark:text-stone-400 text-sm font-semibold">{title}</span>
        <p className="text-stone-500 dark:text-stone-400 text-xs">{description}</p>
      </div>
    </div>
  )
}
