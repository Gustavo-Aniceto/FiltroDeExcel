import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recipeSchema } from '@excelflow/contracts';
import { AppError } from '../../lib/errors.js';
import { validate } from '../../lib/validation.js';
import * as repo from './recipes.repository.js';

const upsertSchema = z.object({
  name: z.string().trim().min(1, 'Informe um nome para a regra').max(200),
  description: z.string().max(2000).nullable().optional(),
  definition: recipeSchema,
});

function toResponse(row: repo.RecipeRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    versionNumber: row.version_number,
    definition: row.definition ? JSON.parse(row.definition) : { version: 1, steps: [], metrics: [] },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function recipeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/', async (request, reply) => {
    const rows = await repo.listRecipes(request.currentUser!.id);
    return reply.send({ items: rows.map(toResponse) });
  });

  app.post('/', async (request, reply) => {
    const body = validate(upsertSchema, request.body);
    const userId = request.currentUser!.id;

    // Nome unico por usuario: a regra e escolhida por nome numa lista, e duas
    // "Processamento padrao" tornariam a escolha impossivel.
    if (await repo.nameExists(userId, body.name)) {
      throw AppError.conflict(`Ja existe uma regra chamada "${body.name}".`);
    }

    const created = await repo.createRecipe({
      userId,
      name: body.name,
      description: body.description ?? null,
      definition: body.definition,
    });
    return reply.code(201).send(toResponse(created));
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await repo.findRecipe(id, request.currentUser!.id);
    if (!row) throw AppError.notFound('Regra nao encontrada.');
    return reply.send(toResponse(row));
  });

  app.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(upsertSchema, request.body);
    const userId = request.currentUser!.id;

    if (await repo.nameExists(userId, body.name, id)) {
      throw AppError.conflict(`Ja existe uma regra chamada "${body.name}".`);
    }

    const updated = await repo.updateRecipe({
      id,
      userId,
      name: body.name,
      description: body.description ?? null,
      definition: body.definition,
    });
    if (!updated) throw AppError.notFound('Regra nao encontrada.');
    return reply.send(toResponse(updated));
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await repo.deleteRecipe(id, request.currentUser!.id);
    if (!deleted) throw AppError.notFound('Regra nao encontrada.');
    return reply.code(204).send();
  });
}
