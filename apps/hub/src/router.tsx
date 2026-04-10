import { createBrowserRouter, Navigate } from 'react-router-dom';
import { HubShell } from './shell/HubShell';
import { HomePage } from './pages/HomePage';
import { AprovacoesPage } from './pages/AprovacoesPage';
import { CalendarioPage } from './pages/CalendarioPage';
import { MarcaPage } from './pages/MarcaPage';
import { PaginasPage } from './pages/PaginasPage';
import { PaginaPage } from './pages/PaginaPage';
import { BriefingPage } from './pages/BriefingPage';

export const router = createBrowserRouter([
  {
    path: '/:workspace/hub/:token',
    element: <HubShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'aprovacoes', element: <AprovacoesPage /> },
      { path: 'calendario', element: <CalendarioPage /> },
      { path: 'marca', element: <MarcaPage /> },
      { path: 'paginas', element: <PaginasPage /> },
      { path: 'paginas/:pageId', element: <PaginaPage /> },
      { path: 'briefing', element: <BriefingPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
