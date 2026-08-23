import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { WorkspaceRouteBridge } from './components/WorkspaceRouteBridge';
import { QualityLabPage } from './components/QualityLabPage';
import { installAssistantTransportRecovery } from './services/assistantTransportRecovery';
import { installAssistantTtftBrowserTelemetry } from './services/assistantTtftBrowserTelemetry';
import './index.css';
import './ai-native.css';
import './mobile-workspace-nav.css';
import './assistant-runtime-ui.css';
import './assistant-work-indicator.css';

installAssistantTransportRecovery();
installAssistantTtftBrowserTelemetry();

const qualityRoute = window.location.pathname === '/quality' || window.location.pathname.startsWith('/quality/');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        {qualityRoute ? (
          <QualityLabPage />
        ) : (
          <>
            <WorkspaceRouteBridge>
              <App />
            </WorkspaceRouteBridge>
            <a
              href="/quality"
              title="AI Quality Lab"
              aria-label="AI Quality Lab"
              className="fixed bottom-4 right-4 z-[90] inline-flex h-10 items-center gap-2 rounded-xl border border-theme-border bg-theme-surface px-3 text-xs font-semibold text-theme-text shadow-lg transition hover:bg-theme-surface-hover"
            >
              <FlaskConical size={15} className="text-theme-primary" />
              <span className="hidden sm:inline">Quality Lab</span>
            </a>
          </>
        )}
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
