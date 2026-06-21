import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { TzProvider } from './lib/tz-context';
import { LiveProvider } from './lib/live-context';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <TzProvider>
        <LiveProvider>
          <App />
        </LiveProvider>
      </TzProvider>
    </HashRouter>
  </StrictMode>,
);
