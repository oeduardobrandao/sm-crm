import { avatarColor, avatarLetter } from '../lib/avatar-color';

/** Rounded-square letter tile for a workspace hero (DkWorkspaceDetalhe: 64px, 16px radius). */
export function WorkspaceAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-[26px] font-bold text-white"
      style={{ background: avatarColor(name) }}
    >
      {avatarLetter(name)}
    </span>
  );
}
