// Estúdio v2 placeholder — the OpenPencil iframe shell lands in the CRM-shell slice
// (docs/estudio-v2-editor-contract.md has the URL + bridge protocol it will implement).
// The route and its feature gate stay so "Abrir no Estúdio" keeps a destination meanwhile.
export default function EstudioPage() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '2rem' }}>
      <p style={{ color: 'var(--text-muted)' }}>O novo Estúdio está em construção.</p>
    </div>
  );
}
