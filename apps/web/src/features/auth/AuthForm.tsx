import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Sheet } from 'lucide-react';
import { loginRequestSchema, registerRequestSchema } from '@excelflow/contracts';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ApiError } from '@/lib/api-client';
import { useAuth } from './AuthContext';

type Mode = 'login' | 'register';

/**
 * Formulario unico para entrar e criar conta.
 *
 * As duas telas compartilham layout, validacao e tratamento de erro; separa-las
 * em dois componentes duplicaria tudo isso para trocar um campo e um titulo.
 */
export function AuthForm({ mode }: { mode: Mode }) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [values, setValues] = useState({ email: '', password: '', displayName: '' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === 'register';

  function update(field: keyof typeof values, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    // Limpa o erro do campo assim que o usuario começa a corrigi-lo. Manter a
    // mensagem enquanto ele digita e ruido.
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    // Validacao no cliente usando O MESMO schema do servidor. Ela existe para
    // dar retorno imediato, nao para substituir a do backend -- que continua
    // sendo a autoridade.
    const schema = isRegister ? registerRequestSchema : loginRequestSchema;
    const payload = isRegister
      ? values
      : { email: values.email, password: values.password };

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        if (key && !errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      if (isRegister) {
        await register(parsed.data as never);
      } else {
        await login(parsed.data as never);
      }
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.details.length > 0) {
          const errors: Record<string, string> = {};
          for (const detail of error.details) errors[detail.path] = detail.message;
          setFieldErrors(errors);
        }
        setFormError(error.message);
      } else {
        setFormError('Nao foi possivel conectar ao servidor. Verifique sua conexao.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-brand text-white">
            <Sheet className="size-6" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-content">
            {isRegister ? 'Criar conta' : 'Entrar no ExcelFlow'}
          </h1>
          <p className="mt-1 text-sm text-content-muted">
            {isRegister
              ? 'Configure seu acesso para comecar a automatizar planilhas.'
              : 'Automatize o tratamento e a analise das suas planilhas.'}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-4 rounded-card border border-line bg-surface p-6 shadow-[0_1px_3px_rgba(16,24,40,0.06)]"
        >
          {formError && <Alert tone="danger">{formError}</Alert>}

          {isRegister && (
            <Input
              label="Nome"
              autoComplete="name"
              value={values.displayName}
              onChange={(e) => update('displayName', e.target.value)}
              error={fieldErrors.displayName}
              disabled={submitting}
              required
            />
          )}

          <Input
            label="E-mail"
            type="email"
            autoComplete="email"
            // autoFocus no primeiro campo poupa um clique em uma tela que o
            // usuario vai abrir todos os dias.
            autoFocus={!isRegister}
            value={values.email}
            onChange={(e) => update('email', e.target.value)}
            error={fieldErrors.email}
            disabled={submitting}
            required
          />

          <Input
            label="Senha"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            value={values.password}
            onChange={(e) => update('password', e.target.value)}
            error={fieldErrors.password}
            hint={isRegister ? 'Minimo de 10 caracteres.' : undefined}
            disabled={submitting}
            required
          />

          <Button type="submit" loading={submitting} className="w-full" size="lg">
            {isRegister ? 'Criar conta' : 'Entrar'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-content-muted">
          {isRegister ? (
            <>
              Ja tem uma conta?{' '}
              <Link to="/login" className="font-medium text-brand hover:underline">
                Entrar
              </Link>
            </>
          ) : (
            <>
              Ainda nao tem conta?{' '}
              <Link to="/registrar" className="font-medium text-brand hover:underline">
                Criar conta
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
