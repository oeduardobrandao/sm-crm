import { useId } from 'react';

/**
 * Product attribution, shown once at the foot of every portal page.
 *
 * The mark is inlined rather than loaded from /icon.svg: the hub sets no
 * publicDir and builds under a `/hub/` base, so a root-absolute asset path
 * resolves in neither dev nor production.
 */
export function PoweredByMesaas() {
  const gradient = useId();

  return (
    <div className="flex items-center justify-center gap-2 pt-10 pb-2">
      <span className="text-[11.5px] hub-tx3">powered by</span>
      <svg
        width="15"
        height="10"
        viewBox="0 0 250 170"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <path
          d="M130 90H250V153C250 162.389 242.389 170 233 170H130V90Z"
          fill={`url(#${gradient})`}
        />
        <path d="M0 17C0 7.61116 7.61116 0 17 0H120V80H0V17Z" fill="#3984FF" />
        <rect y="90" width="120" height="80" fill="#FF3F3F" />
        <rect x="130" y="0.240234" width="120" height="80" fill="#6AC9D0" />
        <defs>
          <linearGradient
            id={gradient}
            x1="130"
            y1="90.2402"
            x2="244.5"
            y2="164.74"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#C6229B" />
            <stop offset="0.284203" stopColor="#EA0E78" />
            <stop offset="0.581908" stopColor="#FE3452" />
            <stop offset="0.757174" stopColor="#FE7340" />
            <stop offset="1" stopColor="#FFC32E" />
          </linearGradient>
        </defs>
      </svg>
      <span className="text-[11.5px] font-semibold hub-tx2">mesaas</span>
    </div>
  );
}
