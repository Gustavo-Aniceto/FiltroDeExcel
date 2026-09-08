-- ============================================================================
-- 0004 - Registra QUANDO uma exportacao foi baixada
-- ============================================================================
-- A tabela `exports` ja contava downloads (`download_count`), mas nao guardava
-- o momento do ultimo. A diferenca importa na auditoria: "este arquivo foi
-- baixado 3 vezes" nao responde "quando alguem levou estes dados daqui".
-- ============================================================================

ALTER TABLE dbo.exports ADD downloaded_at DATETIME2(3) NULL;
