/**
 * Router-level error boundary. The most common way to land here is a lazy route
 * chunk that no longer exists after a deploy: `installDeployRecovery()` reloads
 * automatically for that, so anything reaching this screen already failed a reload
 * or hit an unrelated error. Either way, reloading by hand is the useful action.
 */
export default function RouteErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8 text-center">
      <div>
        <h1 className="mb-2 text-xl font-bold text-foreground">Algo deu errado</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Recarregue a página para tentar novamente.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-[hsl(var(--primary-hover))]"
        >
          Recarregar página
        </button>
      </div>
    </div>
  );
}
