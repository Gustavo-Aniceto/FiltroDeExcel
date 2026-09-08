import { CheckCircle2, Circle, UploadCloud } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { useAuth } from '@/features/auth/AuthContext';

/**
 * Placeholder da Fase 1.
 *
 * Na Fase 2 esta tela vira a area de upload ("Arraste sua planilha aqui") e a
 * lista de planilhas recentes. Por enquanto ela confirma que a sessao
 * autenticada funciona ponta a ponta e mostra o roadmap.
 */
const ROADMAP: Array<{ phase: string; title: string; done: boolean }> = [
  { phase: 'Fase 1', title: 'Arquitetura, banco de dados e autenticacao', done: true },
  { phase: 'Fase 2', title: 'Upload, leitura da planilha e dashboard automatico', done: false },
  { phase: 'Fase 3', title: 'Visualizacao em tabela paginada', done: false },
  { phase: 'Fase 4', title: 'Construtor visual de filtros', done: false },
  { phase: 'Fase 5', title: 'Filtros combinados com E / OU', done: false },
  { phase: 'Fase 6', title: 'Somas, medias e contagens', done: false },
  { phase: 'Fase 7', title: 'Exportacao para Excel e CSV', done: false },
  { phase: 'Fase 8', title: 'Regras salvas e reaplicacao', done: false },
  { phase: 'Fase 9', title: 'Historico de processamentos', done: false },
  { phase: 'Fase 10', title: 'Assistente por linguagem natural', done: false },
  { phase: 'Fase 11', title: 'Endurecimento de seguranca e performance', done: false },
];

export default function HomePage() {
  const { user } = useAuth();
  const firstName = user?.displayName.split(' ')[0] ?? '';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-content">
          Ola, {firstName}
        </h1>
        <p className="mt-1 text-sm text-content-muted">
          Sua conta esta ativa. O envio de planilhas chega na proxima fase.
        </p>
      </div>

      <Card>
        <CardBody className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-line-strong py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-sunken">
            <UploadCloud className="size-6 text-content-subtle" aria-hidden="true" />
          </div>
          <div>
            <p className="font-medium text-content">Arraste sua planilha aqui</p>
            <p className="mt-1 text-sm text-content-subtle">
              .xlsx, .xls ou .csv &mdash; disponivel na Fase 2
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Roadmap"
          description="O que ja funciona e o que vem a seguir."
        />
        <CardBody className="p-0">
          <ul className="divide-y divide-line">
            {ROADMAP.map((item) => (
              <li key={item.phase} className="flex items-center gap-3 px-5 py-3">
                {item.done ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <Circle className="size-4 shrink-0 text-line-strong" aria-hidden="true" />
                )}
                <span className="w-16 shrink-0 text-xs font-medium text-content-subtle">
                  {item.phase}
                </span>
                <span
                  className={
                    item.done
                      ? 'text-sm text-content'
                      : 'text-sm text-content-muted'
                  }
                >
                  {item.title}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
