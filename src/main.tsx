import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './ui/ErrorBoundary';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './ui/styles.css';
import { App } from './ui/App';
import { enableFlagFontIfNeeded } from './ui/emoji/flagSupport';

// Systems without flag emoji (Windows) get a small bundled flag font (Twemoji, CC-BY 4.0).
enableFlagFontIfNeeded();

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found.');
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
