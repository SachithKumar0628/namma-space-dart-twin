import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ToastProvider } from './components/Toast.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { AuthGateway } from './components/auth/AuthGateway.tsx';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ToastProvider>
      <AuthGateway>
        <App />
      </AuthGateway>
    </ToastProvider>
  </ErrorBoundary>
);
