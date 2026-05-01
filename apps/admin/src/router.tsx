import { createBrowserRouter } from 'react-router-dom';
import AdminLayout from './layouts/AdminLayout';
import AdminProtectedRoute from './layouts/AdminProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import WorkspacesPage from './pages/WorkspacesPage';
import WorkspaceDetailPage from './pages/WorkspaceDetailPage';
import PlansPage from './pages/PlansPage';
import AdminsPage from './pages/AdminsPage';

export const router = createBrowserRouter([
  {
    path: '/admin/login',
    element: <LoginPage />,
  },
  {
    path: '/admin',
    element: (
      <AdminProtectedRoute>
        <AdminLayout />
      </AdminProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'workspaces', element: <WorkspacesPage /> },
      { path: 'workspaces/:id', element: <WorkspaceDetailPage /> },
      { path: 'plans', element: <PlansPage /> },
      { path: 'admins', element: <AdminsPage /> },
    ],
  },
  {
    path: '*',
    element: (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p style={{ fontFamily: 'sans-serif', color: '#666' }}>Página não encontrada.</p>
      </div>
    ),
  },
]);
