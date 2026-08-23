import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
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
          <WorkspaceRouteBridge>
            <App />
          </WorkspaceRouteBridge>
        )}
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
