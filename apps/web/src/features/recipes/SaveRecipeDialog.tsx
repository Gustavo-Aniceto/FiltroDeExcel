import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Recipe } from '@excelflow/contracts';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api-client';
import { createRecipe, recipeKeys, updateRecipe, type SavedRecipe } from './api';

interface SaveRecipeDialogProps {
  open: boolean;
  onClose: () => void;
  definition: Recipe;
  existing: SavedRecipe[];
  /** Regra atualmente carregada, se houver -- vira o padrao de "atualizar". */
  currentId: string | null;
  onSaved: (recipe: SavedRecipe) => void;
}

export function SaveRecipeDialog({
  open,
  onClose,
  definition,
  existing,
  currentId,
  onSaved,
}: SaveRecipeDialogProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'new' | 'update'>(currentId ? 'update' : 'new');
  const [targetId, setTargetId] = useState(currentId ?? '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === 'update' && targetId) {
        const target = existing.find((recipe) => recipe.id === targetId);
        return updateRecipe(targetId, {
          name: target?.name ?? name,
          description: target?.description ?? null,
          definition,
        });
      }
      return createRecipe({ name, description: description || null, definition });
    },
    onSuccess: (recipe) => {
      void queryClient.invalidateQueries({ queryKey: recipeKeys.all });
      onSaved(recipe);
      setName('');
      setDescription('');
      setError(null);
      onClose();
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'Nao foi possivel salvar a regra.');
    },
  });

  const canSave = mode === 'update' ? Boolean(targetId) : name.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Salvar regra"
      description="Depois voce aplica estas mesmas regras em outra planilha com um clique."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            loading={mutation.isPending}
            disabled={!canSave}
            onClick={() => mutation.mutate()}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        {existing.length > 0 && (
          <Select
            label="O que fazer"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'new' | 'update')}
          >
            <option value="new">Criar uma nova regra</option>
            <option value="update">Atualizar uma regra existente</option>
          </Select>
        )}

        {mode === 'update' ? (
          <Select
            label="Regra a atualizar"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">Escolha uma regra</option>
            {existing.map((recipe) => (
              <option key={recipe.id} value={recipe.id}>
                {recipe.name}
              </option>
            ))}
          </Select>
        ) : (
          <>
            <Input
              label="Nome da regra"
              placeholder="Ex.: Processamento padrao"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <Input
              label="Descricao (opcional)"
              placeholder="O que esta regra faz"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </>
        )}

        <RecipeSummary definition={definition} />
      </div>
    </Modal>
  );
}

/**
 * Resumo do que sera salvo, em portugues.
 *
 * Sem isto o usuario salvaria "algo" sem conferir. Ver a lista do que a regra
 * faz antes de nomea-la e o que torna a regra confiavel meses depois.
 */
function RecipeSummary({ definition }: { definition: Recipe }) {
  const filterStep = definition.steps.find((step) => step.kind === 'filter');
  const others = definition.steps.filter((step) => step.kind !== 'filter');

  return (
    <div className="rounded-md border border-line bg-surface-muted px-3 py-2.5 text-sm">
      <p className="mb-1 font-medium text-content">Esta regra contem</p>
      <ul className="space-y-0.5 text-content-muted">
        {filterStep && <li>· Filtros sobre os registros</li>}
        {others.map((step, index) => (
          <li key={index}>· {STEP_TEXT[step.kind] ?? step.kind}</li>
        ))}
        {definition.metrics.length > 0 && (
          <li>· {definition.metrics.length} analise(s)</li>
        )}
        {definition.steps.length === 0 && definition.metrics.length === 0 && (
          <li>· Nada ainda</li>
        )}
      </ul>
    </div>
  );
}

const STEP_TEXT: Record<string, string> = {
  drop_duplicates: 'Remocao de duplicados',
  drop_empty_rows: 'Remocao de linhas vazias',
  select_columns: 'Selecao de colunas',
  drop_columns: 'Remocao de colunas',
  rename_columns: 'Renomeacao de colunas',
  sort: 'Ordenacao',
  cast: 'Conversao de tipo',
  replace_values: 'Substituicao de valores',
  fill_empty: 'Preenchimento de vazios',
};
