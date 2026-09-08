import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { useAuth } from './AuthContext';

export function ProtectedRoute() {
  const { user, initializing } = useAuth();
  const location = useLocation();

  // Enquanto a sessao esta sendo restaurada nao podemos redirecionar: faria a
  // tela de login piscar a cada F5 para um usuario que esta logado.
  if (initializing) return <FullPageSpinner label="Restaurando sessao" />;

  if (!user) {
    // `state.from` permite voltar a pagina pretendida depois do login.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
