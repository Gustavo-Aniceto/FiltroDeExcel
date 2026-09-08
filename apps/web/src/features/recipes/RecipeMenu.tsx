import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ListChecks, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { deleteRecipe, recipeKeys, type SavedRecipe } from './api';
import { formatDateTime } from '@/lib/utils';

interface RecipeMenuProps {
  recipes: SavedRecipe[];
  currentId: string | null;
  onApply: (recipe: SavedRecipe) => void;
  onCleared: () => void;
}

/**
 * Menu de regras salvas.
 *
 * E aqui que o sistema cumpre a promessa central: escolher "Processamento
 * padrao" e ver todas as regras aplicadas de uma vez, numa planilha nova.
 */
export function RecipeMenu({ recipes, currentId, onApply, onCleared }: RecipeMenuProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const removal = useMutation({
    mutationFn: deleteRecipe,
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: recipeKeys.all });
      if (id === currentId) onCleared();
    },
  });

  return (
    <div className="relative">
      <Button variant="secondary" onClick={() => setOpen((previous) => !previous)}>
        <ListChecks className="size-4" aria-hidden="true" />
        Regras salvas
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-20 mt-1 w-80 rounded-md border border-line bg-surface shadow-lg">
            {recipes.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-content-subtle">
                Nenhuma regra salva ainda.
                <br />
                Monte os filtros e clique em &ldquo;Salvar regra&rdquo;.
              </p>
            ) : (
              <ul className="max-h-80 overflow-y-auto py-1">
                {recipes.map((recipe) => (
                  <li key={recipe.id} className="flex items-center gap-1 px-1">
                    <button
                      type="button"
                      onClick={() => {
                        onApply(recipe);
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-start gap-2 rounded px-2.5 py-2 text-left hover:bg-surface-muted"
                    >
                      <Check
                        className={
                          recipe.id === currentId
                            ? 'mt-0.5 size-4 shrink-0 text-success'
                            : 'mt-0.5 size-4 shrink-0 text-transparent'
                        }
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-content">
                          {recipe.name}
                        </span>
                        <span className="block truncate text-xs text-content-subtle">
                          {recipe.description ||
                            `Atualizada em ${formatDateTime(recipe.updatedAt)}`}
                        </span>
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Excluir ${recipe.name}`}
                      loading={removal.isPending && removal.variables === recipe.id}
                      onClick={() => removal.mutate(recipe.id)}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
