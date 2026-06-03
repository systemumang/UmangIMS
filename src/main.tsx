import React, { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

function formatUnknownError(err: unknown) {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  return { message: String(err), stack: undefined };
}

function isDynamicImportLoadError(err: unknown) {
  const { message, stack } = formatUnknownError(err);
  const text = `${message}\n${stack ?? ''}`.toLowerCase();
  return (
    text.includes('failed to fetch dynamically imported module') ||
    text.includes('importing a module script failed') ||
    text.includes('loading chunk') ||
    text.includes('chunkloaderror')
  );
}

function recoverDynamicImportLoadError(err: unknown) {
  if (!isDynamicImportLoadError(err)) return false;
  const build = String((window as any).__APP_BUILD__ ?? 'unknown');
  const key = `ims.dynamic-import-reload.${build}`;
  try {
    if (sessionStorage.getItem(key) === '1') return false;
    sessionStorage.setItem(key, '1');
  } catch {
    return false;
  }
  const url = new URL(window.location.href);
  url.searchParams.set('reload', Date.now().toString());
  window.location.replace(url.toString());
  return true;
}

function FatalScreen({ title, message, stack }: { title: string; message: string; stack?: string }) {
  return (
    <div style={{ padding: 16, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>{message}</div>
      {stack ? (
        <details>
          <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Stack</summary>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{stack}</pre>
        </details>
      ) : null}
      <div style={{ marginTop: 16, fontSize: 12, opacity: 0.8 }}>
        Open DevTools Console for more details.
      </div>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: React.ReactNode }, { err: unknown | null }> {
  state = { err: null as unknown | null };

  static getDerivedStateFromError(err: unknown) {
    return { err };
  }

  componentDidCatch(err: unknown) {
    recoverDynamicImportLoadError(err);
  }

  render() {
    if (this.state.err) {
      const { message, stack } = formatUnknownError(this.state.err);
      return <FatalScreen title="App crashed while rendering" message={message} stack={stack} />;
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');
const root = createRoot(rootEl);

function showFatal(title: string, err: unknown) {
  if (recoverDynamicImportLoadError(err)) return;
  const { message, stack } = formatUnknownError(err);
  root.render(
    <StrictMode>
      <FatalScreen title={title} message={message} stack={stack} />
    </StrictMode>
  );
}

window.addEventListener('error', (e) => {
  if ((e as any)?.error) showFatal('Unhandled error', (e as any).error);
});
window.addEventListener('unhandledrejection', (e) => {
  showFatal('Unhandled promise rejection', (e as PromiseRejectionEvent).reason);
});

try {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
} catch (e) {
  showFatal('Failed to start app', e);
}
