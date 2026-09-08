import { LogOut, Sheet } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthContext';

/**
 * Casca da aplicacao autenticada.
 *
 * A navegacao lateral entra na Fase 2, quando existirem secoes de fato
 * (Planilhas, Receitas, Historico). Criar uma sidebar vazia agora seria
 * inventar estrutura antes de haver conteudo.
 */
export function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-lg bg-brand text-white">
              <Sheet className="size-4" aria-hidden="true" />
            </div>
            <span className="font-semibold text-content">ExcelFlow</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight text-content">
                {user?.displayName}
              </p>
              <p className="text-xs leading-tight text-content-subtle">{user?.email}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              <LogOut className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
