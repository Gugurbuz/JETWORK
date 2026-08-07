import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { WorkspaceRouteBridge } from './components/WorkspaceRouteBridge';
import './index.css';

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
