-- ============================================================================
-- 0003 - Substitui indices filtrados por indices simples
-- ============================================================================
-- PROBLEMA ENCONTRADO EM TESTE:
--
-- SQL Server exige SET QUOTED_IDENTIFIER ON para executar QUALQUER DML numa
-- tabela que tenha indice filtrado. Uma conexao com a opcao OFF recebe:
--
--   Msg 1934: UPDATE failed because the following SET options have incorrect
--   settings: 'QUOTED_IDENTIFIER'
--
-- O driver TDS do Node ja usa ON, entao a API funciona. Mas sqlcmd em certos
-- modos, ferramentas de ETL, jobs do SQL Agent e varios clientes legados usam
-- OFF por padrao -- e falhariam ao escrever nestas tabelas. Descobrir isso em
-- producao, dentro de uma rotina de manutencao, seria caro.
--
-- O ganho do filtro era marginal: `datasets` e `exports` guardam uma linha por
-- upload, nao milhoes. Um indice simples atende igual e nao carrega a
-- armadilha. Trocar a previsibilidade operacional por essa otimizacao nao se
-- justifica.
-- ============================================================================

DROP INDEX IX_datasets_expires ON dbo.datasets;
GO

CREATE INDEX IX_datasets_expires ON dbo.datasets (expires_at, status);
GO

DROP INDEX IX_exports_expires ON dbo.exports;
GO

CREATE INDEX IX_exports_expires ON dbo.exports (expires_at);
