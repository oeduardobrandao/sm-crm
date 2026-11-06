// Shown for an unknown `card` or `v` (the server is newer than this bundle), for a render
// crash, and while the host has not pushed the tool result yet.
import { Loader2, RefreshCw } from 'lucide-react';

export function Fallback({ message }: { message?: string }) {
  return (
    <section className="mw-card mw-fallback" aria-label="Cartão do Mesaas">
      <div className="mw-body">
        <strong className="mw-title">
          <RefreshCw size={14} aria-hidden="true" /> Atualize o conector
        </strong>
        <span className="mw-hint">
          {message ??
            'Este cartão é de uma versão mais nova do Mesaas. Atualize o conector do Mesaas nas configurações do chat e peça de novo.'}
        </span>
      </div>
    </section>
  );
}

export function Loading() {
  return (
    <section className="mw-card mw-fallback" aria-label="Cartão do Mesaas" aria-busy="true">
      <div className="mw-body">
        <span className="mw-hint">
          <Loader2 className="mw-spin" size={14} aria-hidden="true" /> Carregando o cartão do
          Mesaas...
        </span>
      </div>
    </section>
  );
}

export function ResultError({ message }: { message: string }) {
  return (
    <section className="mw-card mw-fallback" aria-label="Cartão do Mesaas">
      <div className="mw-body">
        <p className="mw-notice mw-notice-error" role="alert">
          {message || 'Não deu certo agora. Tente de novo em instantes.'}
        </p>
      </div>
    </section>
  );
}
