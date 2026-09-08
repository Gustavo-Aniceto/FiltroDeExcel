import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  BookmarkPlus,
  Download,
  Filter,
  LayoutDashboard,
  RotateCcw,
  Search,
  Wand2,
} from 'lucide-react';
import type { DatasetProfile } from '@excelflow/contracts';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api-client';
import { cn, formatInteger } from '@/lib/utils';
import { datasetKeys, fetchDatasetProfile } from '../datasets/api';
import { DatasetDashboard } from '../dashboard/DatasetDashboard';
import { DataGrid } from '../grid/DataGrid';
import { FilterBuilder } from '../filters/FilterBuilder';
import { countConditions } from '../filters/filter-tree';
import { TransformPanel } from '../transform/TransformPanel';
import { AnalysisPanel, MetricCards } from '../analysis/AnalysisPanel';
import { SaveRecipeDialog } from '../recipes/SaveRecipeDialog';
import { fetchRecipes, recipeKeys, type SavedRecipe } from '../recipes/api';
import { ExportDialog } from '../export/ExportDialog';
import { RecipeMenu } from '../recipes/RecipeMenu';
import { useRecipe } from './useRecipe';

type Tab = 'dashboard' | 'filters' | 'transform' | 'analysis';

const TABS: Array<{ id: Tab; label: string; icon: typeof Filter }> = [
  { id: 'dashboard', label: 'Visao geral', icon: LayoutDashboard },
  { id: 'filters', label: 'Filtros', icon: Filter },
  { id: 'transform', label: 'Tratamento', icon: Wand2 },
  { id: 'analysis', label: 'Analises', icon: BarChart3 },
];

/**
 * Espaco de trabalho da planilha.
 *
 * Uma tela so, e nao um assistente de varias etapas. O motivo e o fluxo real:
 * o usuario ajusta um filtro, olha o resultado, ajusta de novo. Separar em
 * paginas obrigaria a ir e voltar a cada tentativa. Aqui as regras ficam em
 * cima, o resultado embaixo, e cada mudanca reflete na hora.
 */
export function WorkspacePage() {
  const { id = '' } = useParams();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [saveOpen, setSaveOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [currentRecipe, setCurrentRecipe] = useState<SavedRecipe | null>(null);

  const { data: profile, isLoading, error } = useQuery({
    queryKey: datasetKeys.detail(id),
    queryFn: () => fetchDatasetProfile(id),
    enabled: id.length > 0,
  });

  const { data: recipes } = useQuery({
    queryKey: recipeKeys.list(),
    queryFn: fetchRecipes,
  });

  const engine = useRecipe(id);

  const resultColumns = engine.result?.columns ?? [];
  const conditionCount = useMemo(() => countConditions(engine.filter), [engine.filter]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Carregando planilha" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert tone="danger" title="Nao foi possivel abrir a planilha">
          {error instanceof ApiError ? error.message : 'Tente novamente em instantes.'}
        </Alert>
      </div>
    );
  }

  const filtered = engine.result
    ? engine.result.totalRows !== engine.result.inputRows
    : false;

  return (
    <div className="space-y-4">
      <BackLink />

      <header data-testid="workspace-header" className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold text-content">
            {profile.dataset.originalFilename}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-content-muted">
            {engine.result ? (
              <>
                <span>
                  <strong className="text-content">
                    {formatInteger(engine.result.totalRows)}
                  </strong>{' '}
                  de {formatInteger(engine.result.inputRows)} registros
                </span>
                {filtered && <Badge tone="brand">filtrado</Badge>}
                {currentRecipe && <Badge tone="success">{currentRecipe.name}</Badge>}
              </>
            ) : (
              <span>{formatInteger(profile.dataset.rowCount)} registros</span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <RecipeMenu
            recipes={recipes?.items ?? []}
            currentId={currentRecipe?.id ?? null}
            onApply={(recipe) => {
              engine.loadRecipe(recipe.definition);
              setCurrentRecipe(recipe);
              setTab('filters');
            }}
            onCleared={() => {
              engine.reset();
              setCurrentRecipe(null);
            }}
          />
          <Button variant="secondary" onClick={() => setSaveOpen(true)} disabled={engine.isPristine}>
            <BookmarkPlus className="size-4" aria-hidden="true" />
            Salvar regra
          </Button>
          <Button onClick={() => setExportOpen(true)}>
            <Download className="size-4" aria-hidden="true" />
            Exportar
          </Button>
        </div>
      </header>

      {/* Abas do painel de regras. Os contadores mostram o que ja foi definido
          sem obrigar a abrir cada aba para conferir. */}
      <div className="flex flex-wrap items-center gap-1 border-b border-line">
        {TABS.map((item) => {
          const Icon = item.icon;
          const count =
            item.id === 'filters'
              ? conditionCount
              : item.id === 'transform'
                ? engine.steps.length
                : item.id === 'analysis'
                  ? engine.metrics.length
                  : 0;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === item.id
                  ? 'border-brand text-brand'
                  : 'border-transparent text-content-muted hover:text-content',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
              {count > 0 && (
                <span className="ml-0.5 rounded bg-surface-sunken px-1.5 text-xs tabular-nums text-content-muted">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'dashboard' ? (
        <DatasetDashboard profile={profile} />
      ) : (
        <>
          <section className="rounded-card border border-line bg-surface p-4">
            {tab === 'filters' && (
              <FilterBuilder
                value={engine.filter}
                onChange={engine.setFilter}
                columns={profile.columns}
                datasetId={id}
              />
            )}
            {tab === 'transform' && (
              <TransformPanel
                steps={engine.steps}
                onChange={engine.setSteps}
                columns={profile.columns}
                resultColumns={resultColumns}
              />
            )}
            {tab === 'analysis' && (
              <AnalysisPanel
                metrics={engine.metrics}
                onChange={engine.setMetrics}
                columns={profile.columns}
                resultColumns={resultColumns}
              />
            )}
          </section>

          {engine.error && (
            <Alert tone="danger" title="As regras nao puderam ser aplicadas">
              {engine.error}
            </Alert>
          )}

          {engine.result && engine.result.metrics.length > 0 && (
            <MetricCards metrics={engine.result.metrics} />
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative w-full max-w-xs">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-content-subtle"
                aria-hidden="true"
              />
              <Input
                aria-label="Buscar no resultado"
                placeholder="Buscar em todas as colunas..."
                className="pl-8"
                value={engine.search}
                onChange={(e) => {
                  engine.setSearch(e.target.value);
                  engine.setPage(1);
                }}
              />
            </div>

            {!engine.isPristine && (
              <Button variant="ghost" size="sm" onClick={() => {
                engine.reset();
                setCurrentRecipe(null);
              }}>
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Limpar regras
              </Button>
            )}
          </div>

          <DataGrid
            columns={engine.result?.columns ?? profile.columns.map((c) => c.name)}
            rows={engine.result?.rows ?? []}
            profile={profile.columns}
            page={engine.page}
            pageSize={engine.pageSize}
            totalRows={engine.result?.totalRows ?? 0}
            loading={engine.loading}
            onPageChange={engine.setPage}
            onPageSizeChange={(size) => {
              engine.setPageSize(size);
              engine.setPage(1);
            }}
          />
        </>
      )}

      <SaveRecipeDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        definition={engine.recipe}
        existing={recipes?.items ?? []}
        currentId={currentRecipe?.id ?? null}
        onSaved={setCurrentRecipe}
      />

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        datasetId={id}
        recipe={engine.recipe}
        columns={resultColumns.length > 0 ? resultColumns : profile.columns.map((c) => c.name)}
        totalRows={engine.result?.totalRows ?? profile.dataset.rowCount}
        hasMetrics={engine.metrics.length > 0}
        recipeId={currentRecipe?.id ?? null}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-1.5 text-sm text-content-muted hover:text-content"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Voltar para planilhas
    </Link>
  );
}
