import type { Recipe } from '@excelflow/contracts';
import { api } from '@/lib/api-client';

export interface SavedRecipe {
  id: string;
  name: string;
  description: string | null;
  versionNumber: number | null;
  definition: Recipe;
  createdAt: string;
  updatedAt: string;
}

export const recipeKeys = {
  all: ['recipes'] as const,
  list: () => ['recipes', 'list'] as const,
};

export function fetchRecipes(): Promise<{ items: SavedRecipe[] }> {
  return api.get('/recipes');
}

export function createRecipe(input: {
  name: string;
  description?: string | null;
  definition: Recipe;
}): Promise<SavedRecipe> {
  return api.post('/recipes', input);
}

export function updateRecipe(
  id: string,
  input: { name: string; description?: string | null; definition: Recipe },
): Promise<SavedRecipe> {
  return api.put(`/recipes/${id}`, input);
}

export function deleteRecipe(id: string): Promise<void> {
  return api.delete(`/recipes/${id}`);
}
