/**
 * @excelflow/contracts
 *
 * Fonte unica de verdade dos tipos e schemas trocados entre frontend, API e
 * engine. Todo schema e definido com Zod: o mesmo objeto valida em runtime na
 * API e gera o tipo TypeScript no frontend, o que torna impossivel os dois
 * lados divergirem silenciosamente.
 *
 * O engine em Python consome o JSON Schema derivado destes mesmos schemas
 * (`pnpm --filter @excelflow/contracts json-schema`), de modo que as tres
 * partes do sistema compartilham uma unica definicao de contrato.
 */
export * from './common.js';
export * from './auth.js';
export * from './dataset.js';
export * from './filters.js';
export * from './recipe.js';
export * from './execution.js';
