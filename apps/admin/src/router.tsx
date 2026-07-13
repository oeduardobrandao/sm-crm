import { createBrowserRouter } from 'react-router-dom';
import AdminLayout from './layouts/AdminLayout';
import AdminProtectedRoute from './layouts/AdminProtectedRoute';

export const router = createBrowserRouter([
  {
    path: '/admin/login',
    lazy: async () => ({ Component: (await import('./pages/LoginPage')).default }),
  },
  {
    path: '/admin',
    element: (
      <AdminProtectedRoute>
        <AdminLayout />
      </AdminProtectedRoute>
    ),
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import('./pages/DashboardPage')).default }),
      },
      {
        path: 'workspaces',
        lazy: async () => ({ Component: (await import('./pages/WorkspacesPage')).default }),
      },
      {
        path: 'workspaces/:id',
        lazy: async () => ({ Component: (await import('./pages/WorkspaceDetailPage')).default }),
      },
      {
        path: 'plans',
        lazy: async () => ({ Component: (await import('./pages/PlansPage')).default }),
      },
      {
        path: 'admins',
        lazy: async () => ({ Component: (await import('./pages/AdminsPage')).default }),
      },
      {
        path: 'banners',
        lazy: async () => ({ Component: (await import('./pages/BannersPage')).default }),
      },
      {
        path: 'kb-articles',
        lazy: async () => ({ Component: (await import('./pages/KbArticlesPage')).default }),
      },
      {
        path: 'kb-articles/new',
        lazy: async () => ({ Component: (await import('./pages/KbArticleEditorPage')).default }),
      },
      {
        path: 'kb-articles/:id/edit',
        lazy: async () => ({ Component: (await import('./pages/KbArticleEditorPage')).default }),
      },
    ],
  },
  {
    path: '*',
    element: (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
        }}
      >
        <p style={{ fontFamily: 'sans-serif', color: '#666' }}>Página não encontrada.</p>
      </div>
    ),
  },
]);
