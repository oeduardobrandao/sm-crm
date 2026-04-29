import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { initI18n } from '@mesaas/i18n';
import ptCommon from '../../../packages/i18n/locales/pt/common.json';
import enCommon from '../../../packages/i18n/locales/en/common.json';
import App from './App';
import '../style.css';

initI18n({
  pt: { common: ptCommon },
  en: { common: enCommon },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
