import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { handleEntitlementMutationError } from './lib/entitlement-toast';
import * as Sentry from '@sentry/react';
import { Analytics } from '@vercel/analytics/react';
import { AuthProvider } from './context/AuthContext';
import { Toaster } from '@/components/ui/sonner';
import { Spinner } from '@/components/ui/spinner';
import AppLayout from './components/layout/AppLayout';
import ProtectedRoute from './components/layout/ProtectedRoute';
import { marketingPageBySlug } from '@/content/paginas';

// Public pages
const LoginPage = lazy(() => import('./pages/login/LoginPage'));
const ConfigurarSenhaPage = lazy(() => import('./pages/configurar-senha/ConfigurarSenhaPage'));
const WorkspaceSetupPage = lazy(() => import('./pages/workspace-setup/WorkspaceSetupPage'));
const ConsentPage = lazy(() => import('./pages/oauth/ConsentPage'));
const PoliticaPage = lazy(() => import('./pages/politica-privacidade/PoliticaPage'));
const TermosPage = lazy(() => import('./pages/termos-de-uso/TermosPage'));
const LgpdPage = lazy(() => import('./pages/lgpd/LgpdPage'));
const LandingPage = lazy(() => import('./pages/landing/LandingPage'));
const NovidadesPage = lazy(() => import('./pages/novidades/NovidadesPage'));
const BlogIndexPage = lazy(() => import('./pages/blog/BlogIndexPage'));
const BlogPostPage = lazy(() => import('./pages/blog/BlogPostPage'));
const PrecosPage = lazy(() => import('./pages/precos/PrecosPage'));
const MarketingPage = lazy(() => import('./pages/marketing/MarketingPage'));

// Protected pages
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));
const ClientesPage = lazy(() => import('./pages/clientes/ClientesPage'));
const ClienteDetalhePage = lazy(() => import('./pages/cliente-detalhe/ClienteDetalhePage'));
const FinanceiroPage = lazy(() => import('./pages/financeiro/FinanceiroPage'));
const ContratosPage = lazy(() => import('./pages/contratos/ContratosPage'));
const LeadsPage = lazy(() => import('./pages/leads/LeadsPage'));
const EquipePage = lazy(() => import('./pages/equipe/EquipePage'));
const MembroDetalhePage = lazy(() => import('./pages/membro-detalhe/MembroDetalhePage'));
const ConfiguracaoLayout = lazy(() => import('./pages/configuracao/ConfiguracaoLayout'));
const PerfilTab = lazy(() => import('./pages/configuracao/tabs/PerfilTab'));
const WorkspaceTab = lazy(() => import('./pages/configuracao/tabs/WorkspaceTab'));
const MembrosTab = lazy(() => import('./pages/configuracao/tabs/MembrosTab'));
const RelatoriosTab = lazy(() => import('./pages/configuracao/tabs/RelatoriosTab'));
const CobrancaPage = lazy(() => import('./pages/configuracao/cobranca/CobrancaPage'));
const IntegracoesClaudePage = lazy(() => import('./pages/configuracao/mcp/IntegracoesClaudePage'));
const CalendarioPage = lazy(() => import('./pages/calendario/CalendarioPage'));
const EntregasPage = lazy(() => import('./pages/entregas/EntregasPage'));
const ExpressPostPage = lazy(() => import('./pages/post-express/ExpressPostPage'));
const AnalyticsPage = lazy(() => import('./pages/analytics/AnalyticsPage'));
const AnalyticsContaPage = lazy(() => import('./pages/analytics-conta/AnalyticsContaPage'));
const AnalyticsFluxosPage = lazy(() => import('./pages/analytics-fluxos/AnalyticsFluxosPage'));
const IdeiasPage = lazy(() => import('./pages/ideias/IdeiasPage'));
const ArquivosPage = lazy(() => import('./pages/arquivos/ArquivosPage'));
const ImportarPage = lazy(() => import('./pages/importar/ImportarPage'));
const AjudaPage = lazy(() => import('./pages/ajuda/AjudaPage'));
const SecaoPage = lazy(() => import('./pages/ajuda/SecaoPage'));
const ArtigoPage = lazy(() => import('./pages/ajuda/ArtigoPage'));
const NotFoundPage = lazy(() => import('./pages/not-found/NotFoundPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
  mutationCache: new MutationCache({
    onError: (error) => {
      // Entitlement errors get a universal upgrade toast; everything else falls
      // through to each mutation's own onError.
      handleEntitlementMutationError(error);
    },
  }),
});

const PageFallback = (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
    <Spinner size="lg" />
  </div>
);

function MarketingRoute({ slug }: { slug: string }) {
  const page = marketingPageBySlug(slug);
  if (!page) return <Navigate to="/" replace />;
  return <MarketingPage page={page} />;
}

export default function App() {
  return (
    <Sentry.ErrorBoundary
      fallback={
        <div className="flex items-center justify-center h-screen text-center p-8">
          <div>
            <h1 className="text-xl font-bold mb-2">Algo deu errado</h1>
            <p className="text-muted-foreground">Recarregue a página para tentar novamente.</p>
          </div>
        </div>
      }
    >
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Toaster />
          <Suspense fallback={PageFallback}>
            <Routes>
              {/* Public routes */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/precos" element={<PrecosPage />} />
              <Route path="/sobre" element={<MarketingRoute slug="sobre" />} />
              <Route
                path="/aprovacao-de-post"
                element={<MarketingRoute slug="aprovacao-de-post" />}
              />
              <Route
                path="/portal-do-cliente"
                element={<MarketingRoute slug="portal-do-cliente" />}
              />
              <Route
                path="/agente-de-conteudo-ia"
                element={<MarketingRoute slug="agente-de-conteudo-ia" />}
              />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/configurar-senha" element={<ConfigurarSenhaPage />} />
              <Route path="/politica-de-privacidade" element={<PoliticaPage />} />
              <Route path="/termos-de-uso" element={<TermosPage />} />
              <Route path="/lgpd" element={<LgpdPage />} />
              <Route path="/novidades" element={<NovidadesPage />} />
              <Route path="/blog" element={<BlogIndexPage />} />
              <Route path="/blog/:slug" element={<BlogPostPage />} />

              {/* Protected routes without sidebar layout */}
              <Route
                path="/workspace-setup"
                element={
                  <ProtectedRoute>
                    <WorkspaceSetupPage />
                  </ProtectedRoute>
                }
              />
              {/* OAuth 2.1 consent — Supabase's Authorization Path redirects here during authorize */}
              <Route
                path="/oauth/consent"
                element={
                  <ProtectedRoute>
                    <ConsentPage />
                  </ProtectedRoute>
                }
              />

              {/* Protected routes with sidebar layout */}
              <Route
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/clientes" element={<ClientesPage />} />
                <Route path="/clientes/:id" element={<ClienteDetalhePage />} />
                <Route path="/financeiro" element={<FinanceiroPage />} />
                <Route path="/contratos" element={<ContratosPage />} />
                <Route path="/leads" element={<LeadsPage />} />
                <Route path="/equipe" element={<EquipePage />} />
                <Route path="/equipe/:id" element={<MembroDetalhePage />} />
                <Route path="/configuracao" element={<ConfiguracaoLayout />}>
                  <Route index element={<Navigate to="/configuracao/perfil" replace />} />
                  <Route path="perfil" element={<PerfilTab />} />
                  <Route path="workspace" element={<WorkspaceTab />} />
                  <Route path="membros" element={<MembrosTab />} />
                  <Route path="relatorios" element={<RelatoriosTab />} />
                  <Route path="mcp" element={<IntegracoesClaudePage />} />
                  <Route path="cobranca" element={<CobrancaPage />} />
                </Route>
                <Route path="/calendario" element={<CalendarioPage />} />
                <Route path="/entregas" element={<EntregasPage />} />
                <Route path="/post-express" element={<ExpressPostPage />} />
                <Route path="/arquivos" element={<ArquivosPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/analytics/:id" element={<AnalyticsContaPage />} />
                <Route path="/analytics-fluxos" element={<AnalyticsFluxosPage />} />
                <Route path="/ideias" element={<IdeiasPage />} />
                <Route path="/importar" element={<ImportarPage />} />
                <Route path="/ajuda" element={<AjudaPage />} />
                <Route path="/ajuda/secao/:category" element={<SecaoPage />} />
                <Route path="/ajuda/secao" element={<Navigate to="/ajuda" replace />} />
                <Route path="/ajuda/:slug" element={<ArtigoPage />} />
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
          <Analytics />
        </AuthProvider>
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  );
}
