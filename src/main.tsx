import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
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
import './assistant-mobile-clean.css';

installAssistantTransportRecovery();
installAssistantTtftBrowserTelemetry();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/quality/*" element={<QualityLabPage />} />
          <Route
            path="/*"
            element={(
              <WorkspaceRouteBridge>
                <App />
              </WorkspaceRouteBridge>
            )}
          />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
