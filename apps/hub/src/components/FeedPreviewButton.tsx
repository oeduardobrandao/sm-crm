interface FeedPreviewButtonProps {
  selectedCount: number;
  onClick: () => void;
}

export function FeedPreviewButton({ selectedCount, onClick }: FeedPreviewButtonProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex justify-center py-5">
      <button
        onClick={onClick}
        className="inline-flex items-center gap-2 px-7 py-3 rounded-[10px] bg-[#0095f6] text-white text-[14px] font-semibold hover:bg-[#0081d6] transition-colors shadow-sm"
      >
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
        </svg>
        Visualizar no Feed ({selectedCount} selecionado{selectedCount > 1 ? 's' : ''})
      </button>
    </div>
  );
}
