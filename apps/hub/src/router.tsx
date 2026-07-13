import { createBrowserRouter } from 'react-router-dom';
import { HubShell } from './shell/HubShell';

export const router = createBrowserRouter([
  {
    path: '/:workspace/hub/:token',
    element: <HubShell />,
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import('./pages/HomePage')).HomePage }),
      },
      {
        path: 'aprovacoes',
        lazy: async () => ({ Component: (await import('./pages/AprovacoesPage')).AprovacoesPage }),
      },
      {
        path: 'postagens',
        lazy: async () => ({ Component: (await import('./pages/PostagensPage')).PostagensPage }),
      },
      {
        path: 'postagens/:postId',
        lazy: async () => ({
          Component: (await import('./pages/PostagemFocoPage')).PostagemFocoPage,
        }),
      },
      {
        path: 'marca',
        lazy: async () => ({ Component: (await import('./pages/MarcaPage')).MarcaPage }),
      },
      {
        path: 'paginas',
        lazy: async () => ({ Component: (await import('./pages/PaginasPage')).PaginasPage }),
      },
      {
        path: 'paginas/:pageId',
        lazy: async () => ({ Component: (await import('./pages/PaginaPage')).PaginaPage }),
      },
      {
        path: 'briefing',
        lazy: async () => ({ Component: (await import('./pages/BriefingPage')).BriefingPage }),
      },
      {
        path: 'ideias',
        lazy: async () => ({ Component: (await import('./pages/IdeiasPage')).IdeiasPage }),
      },
      {
        path: 'relatorios',
        lazy: async () => ({ Component: (await import('./pages/Relatorios')).RelatoriosPage }),
      },
      {
        path: 'relatorios/:month',
        lazy: async () => ({
          Component: (await import('./pages/RelatorioView')).RelatorioViewPage,
        }),
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
        <p style={{ fontFamily: 'sans-serif', color: '#666' }}>Link inválido.</p>
      </div>
    ),
  },
]);
