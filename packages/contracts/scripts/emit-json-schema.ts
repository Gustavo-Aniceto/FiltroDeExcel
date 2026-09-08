/**
 * Gera JSON Schema a partir dos schemas Zod, para consumo pelo engine Python.
 *
 * Fluxo: Zod (fonte de verdade) -> JSON Schema (artefato versionado) -> Pydantic.
 * Isso mantem TypeScript e Python em sincronia sem duplicar a definicao a mao.
 *
 * Uso: pnpm --filter @excelflow/contracts json-schema
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { filterSchema } from '../src/filters.js';
import { recipeSchema } from '../src/recipe.js';
import { columnProfileSchema } from '../src/dataset.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../services/engine/contracts');
mkdirSync(outDir, { recursive: true });

const bundle = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'ExcelFlow contracts',
  definitions: {
    Filter: zodToJsonSchema(filterSchema, 'Filter'),
    Recipe: zodToJsonSchema(recipeSchema, 'Recipe'),
    ColumnProfile: zodToJsonSchema(columnProfileSchema, 'ColumnProfile'),
  },
};

const outFile = resolve(outDir, 'excelflow.schema.json');
writeFileSync(outFile, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
console.log(`JSON Schema gerado em ${outFile}`);
