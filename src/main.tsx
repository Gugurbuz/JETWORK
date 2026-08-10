import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { WorkspaceRouteBridge } from './components/WorkspaceRouteBridge';
import './index.css';
import './ai-native.css';
import './mobile-workspace-nav.css';
import './assistant-runtime-ui.css';
import './energetic-theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <WorkspaceRouteBridge>
          <App />
        </WorkspaceRouteBridge>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
