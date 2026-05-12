import React from "react"

interface UploadHintProps {
  icon: React.ReactNode
  text: string
}

export function UploadHint({ icon, text }: UploadHintProps) {
  return (
    <div className="flex items-center gap-2 bg-[#fefce8] border border-[#fde68a] rounded-lg px-2.5 py-2">
      <span className="shrink-0">{icon}</span>
      <span className="text-xs text-[#92400e]">{text}</span>
    </div>
  )
}
