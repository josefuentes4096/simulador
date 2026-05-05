import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initI18n } from './locales';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

// Bootstrap i18n before mounting React. Tiny synchronous load (catalogs are
// statically bundled by Vite's glob), so the small async wrap is just to
// satisfy i18next's init contract.
initI18n().then(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
