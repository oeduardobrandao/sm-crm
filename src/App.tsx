import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { Toaster } from '@/components/ui/sonner';
import { Spinner } from '@/components/ui/spinner';
import AppLayout from './components/layout/AppLayout';
import ProtectedRoute from './components/layout/ProtectedRoute';

// Public pages
const LoginPage = lazy(() => import('./pages/login/LoginPage'));
const ConfigurarSenhaPage = lazy(() => import('./pages/configurar-senha/ConfigurarSenhaPage'));
const WorkspaceSetupPage = lazy(() => import('./pages/workspace-setup/WorkspaceSetupPage'));
const PoliticaPage = lazy(() => import('./pages/politica-privacidade/PoliticaPage'));
const PortalPage = lazy(() => import('./pages/portal/PortalPage'));
const LandingPage = lazy(() => import('./pages/landing/LandingPage'));

// Protected pages
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));
const ClientesPage = lazy(() => import('./pages/clientes/ClientesPage'));
const ClienteDetalhePage = lazy(() => import('./pages/cliente-detalhe/ClienteDetalhePage'));
const FinanceiroPage = lazy(() => import('./pages/financeiro/FinanceiroPage'));
const ContratosPage = lazy(() => import('./pages/contratos/ContratosPage'));
const LeadsPage = lazy(() => import('./pages/leads/LeadsPage'));
const EquipePage = lazy(() => import('./pages/equipe/EquipePage'));
const MembroDetalhePage = lazy(() => import('./pages/membro-detalhe/MembroDetalhePage'));
const IntegracoesPage = lazy(() => import('./pages/integracoes/IntegracoesPage'));
const ConfiguracaoPage = lazy(() => import('./pages/configuracao/ConfiguracaoPage'));
const CalendarioPage = lazy(() => import('./pages/calendario/CalendarioPage'));
const EntregasPage = lazy(() => import('./pages/entregas/EntregasPage'));
const AnalyticsPage = lazy(() => import('./pages/analytics/AnalyticsPage'));
const AnalyticsContaPage = lazy(() => import('./pages/analytics-conta/AnalyticsContaPage'));
const AnalyticsFluxosPage = lazy(() => import('./pages/analytics-fluxos/AnalyticsFluxosPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const PageFallback = (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
    <Spinner size="lg" />
  </div>
);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Toaster />
        <Suspense fallback={PageFallback}>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/configurar-senha" element={<ConfigurarSenhaPage />} />
            <Route path="/politica-de-privacidade" element={<PoliticaPage />} />
            <Route path="/portal/:token" element={<PortalPage />} />

            {/* Protected route without sidebar layout */}
            <Route path="/workspace-setup" element={<ProtectedRoute><WorkspaceSetupPage /></ProtectedRoute>} />

            {/* Protected routes with sidebar layout */}
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/clientes" element={<ClientesPage />} />
              <Route path="/clientes/:id" element={<ClienteDetalhePage />} />
              <Route path="/financeiro" element={<FinanceiroPage />} />
              <Route path="/contratos" element={<ContratosPage />} />
              <Route path="/leads" element={<LeadsPage />} />
              <Route path="/equipe" element={<EquipePage />} />
              <Route path="/equipe/:id" element={<MembroDetalhePage />} />
              <Route path="/integracoes" element={<IntegracoesPage />} />
              <Route path="/configuracao" element={<ConfiguracaoPage />} />
              <Route path="/calendario" element={<CalendarioPage />} />
              <Route path="/entregas" element={<EntregasPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/analytics/:id" element={<AnalyticsContaPage />} />
              <Route path="/analytics-fluxos" element={<AnalyticsFluxosPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </QueryClientProvider>
  );
}
