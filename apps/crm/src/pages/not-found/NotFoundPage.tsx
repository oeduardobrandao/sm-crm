import { useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  useEffect(() => {
    document.title = 'Página não encontrada — Mesaas';
    let el = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', 'robots');
      document.head.appendChild(el);
    }
    el.setAttribute('content', 'noindex');
    return () => {
      el?.remove();
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-screen text-center p-8 gap-4">
      <h1 className="text-2xl font-bold">Página não encontrada</h1>
      <p className="text-muted-foreground">
        O endereço que você acessou não existe ou mudou de lugar.
      </p>
      <div className="flex gap-4">
        <Link to="/" className="underline">
          Ir para a página inicial
        </Link>
        <Link to="/login" className="underline">
          Entrar no Mesaas
        </Link>
      </div>
    </div>
  );
}
