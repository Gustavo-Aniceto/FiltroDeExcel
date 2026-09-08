import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm font-medium text-content-subtle">Erro 404</p>
      <h1 className="text-2xl font-semibold text-content">Pagina nao encontrada</h1>
      <p className="max-w-sm text-sm text-content-muted">
        O endereco acessado nao existe ou foi movido.
      </p>
      <Link
        to="/"
        className="mt-2 inline-flex h-10 items-center rounded-md border border-line-strong bg-surface px-4 text-sm font-medium text-content transition-colors hover:bg-surface-muted"
      >
        Voltar ao inicio
      </Link>
    </div>
  );
}
