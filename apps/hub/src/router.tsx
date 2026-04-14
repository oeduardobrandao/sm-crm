import { createBrowserRouter } from 'react-router-dom';
import { HubShell } from './shell/HubShell';
import { HomePage } from './pages/HomePage';
import { AprovacoesPage } from './pages/AprovacoesPage';
import { MarcaPage } from './pages/MarcaPage';
import { PaginasPage } from './pages/PaginasPage';
import { PaginaPage } from './pages/PaginaPage';
import { BriefingPage } from './pages/BriefingPage';
import { PostagensPage } from './pages/PostagensPage';
import { IdeiasPage } from './pages/IdeiasPage';

export const router = createBrowserRouter([
  {
    path: '/:workspace/hub/:token',
    element: <HubShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'aprovacoes', element: <AprovacoesPage /> },
      { path: 'postagens', element: <PostagensPage /> },
      { path: 'marca', element: <MarcaPage /> },
      { path: 'paginas', element: <PaginasPage /> },
      { path: 'paginas/:pageId', element: <PaginaPage /> },
      { path: 'briefing', element: <BriefingPage /> },
      { path: 'ideias', element: <IdeiasPage /> },
    ],
  },
  { path: '*', element: <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p style={{ fontFamily: 'sans-serif', color: '#666' }}>Link inválido.</p></div> },
]);
