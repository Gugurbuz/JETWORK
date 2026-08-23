import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert as AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, retry: () => void) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.props.onError) this.props.onError(error, info);
    else console.error('[ErrorBoundary]', error, info.componentStack);
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.retry);

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-theme-bg text-theme-text">
        <div className="max-w-md w-full bg-theme-surface border border-theme-border rounded-xl p-8 shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
              <AlertTriangle size={20} className="text-red-500" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Beklenmeyen bir hata oluştu</h1>
          </div>
          <p className="text-sm text-theme-text-muted leading-relaxed mb-4">
            Uygulamayı yüklerken bir sorun yaşadık. Sorun devam ederse sayfayı yenilemeyi deneyin.
          </p>
          <pre className="text-[11px] bg-theme-bg border border-theme-border rounded-md p-3 overflow-auto max-h-40 text-theme-text-muted mb-6 whitespace-pre-wrap break-words">
            {error.message}
          </pre>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium text-theme-text-muted hover:text-theme-text transition-colors"
            >
              Sayfayı Yenile
            </button>
            <button
              onClick={this.retry}
              className="px-4 py-2 bg-theme-primary hover:bg-theme-primary-hover text-theme-primary-fg text-sm font-semibold rounded-md transition-colors shadow-sm inline-flex items-center gap-2"
            >
              <RefreshCw size={14} />
              Tekrar Dene
            </button>
          </div>
        </div>
      </div>
    );
  }
}
