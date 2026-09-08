import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api-client';
import HistoryPage from '@/routes/HistoryPage';
import HomePage from '@/routes/HomePage';
import { WorkspacePage } from '@/features/workspace/WorkspacePage';
import LoginPage from '@/routes/LoginPage';
import NotFoundPage from '@/routes/NotFoundPage';
import RegisterPage from '@/routes/RegisterPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Repetir um 401/403/404 nunca vai dar certo e so atrasa a mensagem de
        // erro. Repetimos apenas falhas potencialmente transitorias.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

/** Impede que um usuario ja autenticado veja a tela de login. */
function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, initializing } = useAuth();
  if (initializing) return <FullPageSpinner label="Carregando" />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <PublicOnlyRoute>
                  <LoginPage />
                </PublicOnlyRoute>
              }
            />
            <Route
              path="/registrar"
              element={
                <PublicOnlyRoute>
                  <RegisterPage />
                </PublicOnlyRoute>
              }
            />

            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/planilhas/:id" element={<WorkspacePage />} />
                <Route path="/historico" element={<HistoryPage />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
