/** Hero device mockups for the landing page (dark renders). */
export function HeroDevicesDark() {
  return (
    <div className="lp2-hd">
      <img
        className="lp2-hd-macbook"
        src="/landing/hero-macbook-dark.webp"
        width={1800}
        height={1087}
        alt="MacBook com o quadro de entregas do Mesaas: fluxos por etapa, do briefing à aprovação do cliente"
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
      <img
        className="lp2-hd-iphone"
        src="/landing/hero-iphone-dark.webp"
        width={560}
        height={1160}
        alt="iPhone com o Hub do cliente: aprovações pendentes e próximo post"
        loading="eager"
        decoding="async"
      />
    </div>
  );
}
