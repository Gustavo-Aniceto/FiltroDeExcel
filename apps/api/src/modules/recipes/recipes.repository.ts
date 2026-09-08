import type { Recipe } from '@excelflow/contracts';
import { createRequest, getPool, sql } from '../../db/pool.js';

export interface RecipeRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  current_version_id: string | null;
  version_number: number | null;
  definition: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_WITH_VERSION = `
  SELECT r.id, r.user_id, r.name, r.description, r.current_version_id,
         v.version_number, v.definition, r.created_at, r.updated_at
    FROM dbo.recipes r
    LEFT JOIN dbo.recipe_versions v ON v.id = r.current_version_id
`;

export async function listRecipes(userId: string): Promise<RecipeRow[]> {
  const request = await createRequest();
  const result = await request
    .input('userId', sql.UniqueIdentifier, userId)
    .query<RecipeRow>(`${SELECT_WITH_VERSION} WHERE r.user_id = @userId ORDER BY r.updated_at DESC`);
  return result.recordset;
}

export async function findRecipe(id: string, userId: string): Promise<RecipeRow | null> {
  const request = await createRequest();
  const result = await request
    .input('id', sql.UniqueIdentifier, id)
    .input('userId', sql.UniqueIdentifier, userId)
    .query<RecipeRow>(`${SELECT_WITH_VERSION} WHERE r.id = @id AND r.user_id = @userId`);
  return result.recordset[0] ?? null;
}

/**
 * Cria a receita e sua primeira versao numa transacao.
 *
 * Uma receita sem versao seria um registro inutil: nao ha o que executar. As
 * duas linhas nascem juntas ou nenhuma nasce.
 */
export async function createRecipe(input: {
  userId: string;
  name: string;
  description: string | null;
  definition: Recipe;
}): Promise<RecipeRow> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const created = await new sql.Request(transaction)
      .input('userId', sql.UniqueIdentifier, input.userId)
      .input('name', sql.NVarChar(200), input.name)
      .input('description', sql.NVarChar(2000), input.description)
      .query<{ id: string }>(
        `INSERT INTO dbo.recipes (user_id, name, description)
         OUTPUT inserted.id
         VALUES (@userId, @name, @description)`,
      );
    const recipeId = created.recordset[0]!.id;

    const version = await new sql.Request(transaction)
      .input('recipeId', sql.UniqueIdentifier, recipeId)
      .input('definition', sql.NVarChar(sql.MAX), JSON.stringify(input.definition))
      .input('createdBy', sql.UniqueIdentifier, input.userId)
      .query<{ id: string }>(
        `INSERT INTO dbo.recipe_versions (recipe_id, version_number, definition, created_by)
         OUTPUT inserted.id
         VALUES (@recipeId, 1, @definition, @createdBy)`,
      );

    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, recipeId)
      .input('versionId', sql.UniqueIdentifier, version.recordset[0]!.id)
      .query('UPDATE dbo.recipes SET current_version_id = @versionId WHERE id = @id');

    await transaction.commit();

    const row = await findRecipe(recipeId, input.userId);
    if (!row) throw new Error('Falha ao criar a regra');
    return row;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/**
 * Atualiza a receita criando uma NOVA VERSAO, sem tocar nas anteriores.
 *
 * As versoes sao imutaveis porque o historico aponta para elas. Sobrescrever a
 * definicao faria uma execucao de marco passar a exibir as regras de setembro
 * -- o historico deixaria de ser auditavel.
 */
export async function updateRecipe(input: {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  definition: Recipe;
}): Promise<RecipeRow | null> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const owned = await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, input.id)
      .input('userId', sql.UniqueIdentifier, input.userId)
      .query<{ id: string }>('SELECT id FROM dbo.recipes WHERE id = @id AND user_id = @userId');

    if (owned.recordset.length === 0) {
      await transaction.rollback();
      return null;
    }

    const next = await new sql.Request(transaction)
      .input('recipeId', sql.UniqueIdentifier, input.id)
      .query<{ next_number: number }>(
        `SELECT ISNULL(MAX(version_number), 0) + 1 AS next_number
           FROM dbo.recipe_versions WHERE recipe_id = @recipeId`,
      );

    const version = await new sql.Request(transaction)
      .input('recipeId', sql.UniqueIdentifier, input.id)
      .input('number', sql.Int, next.recordset[0]!.next_number)
      .input('definition', sql.NVarChar(sql.MAX), JSON.stringify(input.definition))
      .input('createdBy', sql.UniqueIdentifier, input.userId)
      .query<{ id: string }>(
        `INSERT INTO dbo.recipe_versions (recipe_id, version_number, definition, created_by)
         OUTPUT inserted.id
         VALUES (@recipeId, @number, @definition, @createdBy)`,
      );

    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, input.id)
      .input('name', sql.NVarChar(200), input.name)
      .input('description', sql.NVarChar(2000), input.description)
      .input('versionId', sql.UniqueIdentifier, version.recordset[0]!.id)
      .query(
        `UPDATE dbo.recipes
            SET name = @name, description = @description,
                current_version_id = @versionId, updated_at = SYSUTCDATETIME()
          WHERE id = @id`,
      );

    await transaction.commit();
    return findRecipe(input.id, input.userId);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function deleteRecipe(id: string, userId: string): Promise<boolean> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // A FK de `recipes.current_version_id` impede apagar a receita enquanto ela
    // apontar para uma versao. Soltamos a referencia primeiro.
    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.UniqueIdentifier, userId)
      .query(
        'UPDATE dbo.recipes SET current_version_id = NULL WHERE id = @id AND user_id = @userId',
      );

    // As execucoes guardam um snapshot proprio da definicao, entao apagar a
    // receita nao apaga o historico -- so solta o vinculo.
    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, id)
      .query('UPDATE dbo.executions SET recipe_id = NULL WHERE recipe_id = @id');

    const result = await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.UniqueIdentifier, userId)
      .query('DELETE FROM dbo.recipes WHERE id = @id AND user_id = @userId');

    await transaction.commit();
    return result.rowsAffected[0] === 1;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function nameExists(
  userId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const request = await createRequest();
  const result = await request
    .input('userId', sql.UniqueIdentifier, userId)
    .input('name', sql.NVarChar(200), name)
    .input('exceptId', sql.UniqueIdentifier, exceptId ?? null)
    .query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM dbo.recipes
        WHERE user_id = @userId AND name = @name
          AND (@exceptId IS NULL OR id <> @exceptId)`,
    );
  return (result.recordset[0]?.total ?? 0) > 0;
}
