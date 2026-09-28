import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      <h1>FINANCE FLOW</h1>
      <p>Gestão financeira pessoal e familiar.</p>
    </main>
  </StrictMode>,
);
