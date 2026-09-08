import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FilterGroup,
  Metric,
  MetricResult,
  Recipe,
  RecipeStep,
} from '@excelflow/contracts';
import { emptyFilterGroup } from '@excelflow/contracts';
import { api, ApiError } from '@/lib/api-client';
import { pruneIncomplete } from '../filters/filter-tree';

export interface PreviewResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  inputRows: number;
  metrics: Array<MetricResult & { error: string | null }>;
  durationMs: number;
}

interface RecipeState {
  filter: FilterGroup;
  steps: RecipeStep[];
  metrics: Metric[];
}

/**
 * Estado da receita em construcao + previa do resultado.
 *
 * O filtro e mantido SEPARADO dos demais passos no estado da interface, porque
 * cada um tem seu painel. Na hora de montar a receita, o filtro entra como o
 * PRIMEIRO passo: filtrar antes de tratar e quase sempre o que o usuario quer
 * (deduplicar so o que passou no filtro, e nao a base inteira) e reduz o volume
 * que os passos seguintes precisam processar.
 */
export function useRecipe(datasetId: string) {
  const [state, setState] = useState<RecipeState>({
    filter: emptyFilterGroup(),
    steps: [],
    metrics: [],
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');

  const [result, setResult] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Receita EFETIVA, enviada ao servidor.
   *
   * Condicoes incompletas sao removidas: enquanto o usuario digita "50" para
   * chegar em "5000", a condicao passa por estados intermediarios. Enviar cada
   * um deles mostraria resultados errados piscando na tela.
   */
  const recipe = useMemo<Recipe>(() => {
    const pruned = pruneIncomplete(state.filter);
    const steps: RecipeStep[] = [];
    if (pruned && pruned.type === 'group' && pruned.children.length > 0) {
      steps.push({ kind: 'filter', filter: pruned });
    }
    steps.push(...state.steps);
    return { version: 1, steps, metrics: state.metrics };
  }, [state]);

  // Chave de identidade da consulta: so refazemos a previa quando algo que
  // afeta o RESULTADO muda. Sem isso, cada render dispararia uma requisicao.
  const queryKey = useMemo(
    () => JSON.stringify({ recipe, page, pageSize, search }),
    [recipe, page, pageSize, search],
  );

  const latestRequest = useRef(0);

  useEffect(() => {
    const requestId = ++latestRequest.current;
    const controller = new AbortController();

    // Debounce: ajustar um filtro dispara varias mudancas em sequencia (escolher
    // coluna, operador, digitar valor). Sem espera, cada tecla viraria uma
    // consulta analitica no servidor.
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await api.post<PreviewResult>(
          `/datasets/${datasetId}/preview`,
          { recipe, page, pageSize, search: search || null, metrics: state.metrics },
          controller.signal,
        );
        // Respostas fora de ordem: uma consulta lenta disparada antes pode
        // chegar depois de uma rapida. Sem esta guarda, a tela mostraria o
        // resultado de um filtro que ja nao esta mais na tela.
        if (requestId === latestRequest.current) {
          setResult(response);
          setError(null);
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (requestId === latestRequest.current) {
          setError(caught instanceof ApiError ? caught.message : 'Falha ao aplicar as regras.');
        }
      } finally {
        if (requestId === latestRequest.current) setLoading(false);
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `queryKey` resume recipe/page/pageSize/search numa string estavel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, queryKey]);

  // Mudar as regras invalida a pagina atual: estar na pagina 7 de um resultado
  // que agora tem 2 paginas mostraria uma tabela vazia sem explicacao.
  const setFilter = useCallback((filter: FilterGroup) => {
    setState((previous) => ({ ...previous, filter }));
    setPage(1);
  }, []);

  const setSteps = useCallback((steps: RecipeStep[]) => {
    setState((previous) => ({ ...previous, steps }));
    setPage(1);
  }, []);

  const setMetrics = useCallback((metrics: Metric[]) => {
    setState((previous) => ({ ...previous, metrics }));
  }, []);

  const loadRecipe = useCallback((loaded: Recipe) => {
    // Ao carregar uma regra salva, separamos de volta o passo de filtro dos
    // demais, para que cada painel receba o que lhe cabe.
    const filterStep = loaded.steps.find((step) => step.kind === 'filter');
    setState({
      filter: filterStep && filterStep.kind === 'filter'
        ? (filterStep.filter as FilterGroup)
        : emptyFilterGroup(),
      steps: loaded.steps.filter((step) => step.kind !== 'filter'),
      metrics: loaded.metrics ?? [],
    });
    setPage(1);
  }, []);

  const reset = useCallback(() => {
    setState({ filter: emptyFilterGroup(), steps: [], metrics: [] });
    setPage(1);
    setSearch('');
  }, []);

  return {
    filter: state.filter,
    steps: state.steps,
    metrics: state.metrics,
    recipe,
    result,
    loading,
    error,
    page,
    pageSize,
    search,
    setFilter,
    setSteps,
    setMetrics,
    setPage,
    setPageSize,
    setSearch,
    loadRecipe,
    reset,
    /** Verdadeiro quando a receita nao faz nada -- usado para desabilitar acoes. */
    isPristine: recipe.steps.length === 0 && state.metrics.length === 0,
  };
}
