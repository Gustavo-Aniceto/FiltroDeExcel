-- ============================================================================
-- 0002 - Datasets, receitas, execucoes e exportacoes
-- ============================================================================
-- PRINCIPIO CENTRAL: nenhuma linha de planilha e armazenada aqui.
--
-- Estas tabelas guardam METADADOS (o que foi enviado), REGRAS (o que fazer) e
-- HISTORICO (o que aconteceu). As linhas em si vivem em Parquet no storage,
-- com TTL. Ver ARCHITECTURE.md secao 2.1 para a justificativa.
-- ============================================================================

CREATE TABLE dbo.datasets (
    id                    UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_datasets_id DEFAULT NEWSEQUENTIALID(),
    user_id               UNIQUEIDENTIFIER NOT NULL,
    original_filename     NVARCHAR(400)    NOT NULL,
    extension             VARCHAR(10)      NOT NULL,
    size_bytes            BIGINT           NOT NULL,
    -- SHA-256 do arquivo enviado: permite detectar reenvio do mesmo arquivo e
    -- serve de evidencia de que o original nao foi alterado.
    content_hash          BINARY(32)       NULL,
    -- Caminhos RELATIVOS ao STORAGE_ROOT. Guardar caminho absoluto amarraria o
    -- banco ao sistema de arquivos de uma maquina especifica e quebraria a
    -- migracao futura para S3/Azure Blob.
    original_path         NVARCHAR(500)    NULL,
    parquet_path          NVARCHAR(500)    NULL,
    sheet_name            NVARCHAR(200)    NULL,
    row_count             INT              NOT NULL CONSTRAINT DF_datasets_row_count DEFAULT 0,
    column_count          INT              NOT NULL CONSTRAINT DF_datasets_column_count DEFAULT 0,
    duplicate_row_count   INT              NOT NULL CONSTRAINT DF_datasets_dup DEFAULT 0,
    rows_with_empty_count INT              NOT NULL CONSTRAINT DF_datasets_empty DEFAULT 0,
    status                VARCHAR(20)      NOT NULL CONSTRAINT DF_datasets_status DEFAULT 'pending',
    error_message         NVARCHAR(2000)   NULL,
    created_at            DATETIME2(3)     NOT NULL CONSTRAINT DF_datasets_created_at DEFAULT SYSUTCDATETIME(),
    processed_at          DATETIME2(3)     NULL,
    -- Apos esta data o job de limpeza apaga os arquivos. A linha permanece,
    -- com status 'expired', para o historico continuar fazendo sentido.
    expires_at            DATETIME2(3)     NULL,
    CONSTRAINT PK_datasets PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_datasets_user FOREIGN KEY (user_id) REFERENCES dbo.users (id) ON DELETE CASCADE,
    CONSTRAINT CK_datasets_status CHECK (status IN ('pending','processing','ready','failed','expired'))
);

CREATE INDEX IX_datasets_user_created ON dbo.datasets (user_id, created_at DESC);
-- Sustenta o job de limpeza por TTL sem varrer a tabela inteira.
CREATE INDEX IX_datasets_expires ON dbo.datasets (expires_at) WHERE expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Perfil das colunas
-- ---------------------------------------------------------------------------
-- Esta tabela e a WHITELIST que torna a compilacao de SQL segura: o engine so
-- aceita uma coluna numa receita se ela existir aqui para aquele dataset.
-- Nenhum identificador SQL vem de texto do usuario.
-- ---------------------------------------------------------------------------
CREATE TABLE dbo.dataset_columns (
    id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_dataset_columns_id DEFAULT NEWSEQUENTIALID(),
    dataset_id      UNIQUEIDENTIFIER NOT NULL,
    name            NVARCHAR(255)    NOT NULL,
    position        INT              NOT NULL,
    inferred_type   VARCHAR(20)      NOT NULL,
    null_count      INT              NOT NULL CONSTRAINT DF_dataset_columns_null DEFAULT 0,
    distinct_count  INT              NOT NULL CONSTRAINT DF_dataset_columns_distinct DEFAULT 0,
    -- DECIMAL(38,10), nao FLOAT: valores monetarios nao toleram erro binario.
    min_value       DECIMAL(38,10)   NULL,
    max_value       DECIMAL(38,10)   NULL,
    sum_value       DECIMAL(38,10)   NULL,
    avg_value       DECIMAL(38,10)   NULL,
    min_date        DATETIME2(3)     NULL,
    max_date        DATETIME2(3)     NULL,
    -- JSON: valores mais frequentes e amostras, para o autocomplete dos filtros.
    top_values      NVARCHAR(MAX)    NULL,
    sample_values   NVARCHAR(MAX)    NULL,
    CONSTRAINT PK_dataset_columns PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_dataset_columns_dataset FOREIGN KEY (dataset_id) REFERENCES dbo.datasets (id) ON DELETE CASCADE,
    CONSTRAINT CK_dataset_columns_type CHECK (inferred_type IN ('text','number','currency','date','boolean','empty'))
);

CREATE UNIQUE INDEX UX_dataset_columns_dataset_name ON dbo.dataset_columns (dataset_id, name);
CREATE INDEX IX_dataset_columns_dataset_position ON dbo.dataset_columns (dataset_id, position);

-- ---------------------------------------------------------------------------
-- Receitas
-- ---------------------------------------------------------------------------
-- `recipes` guarda a identidade ("Processamento padrao"); `recipe_versions`
-- guarda o JSON. A separacao existe porque o historico precisa saber QUAL
-- versao rodou: se a receita e editada depois, uma execucao de marco nao pode
-- passar a exibir as regras de setembro.
-- ---------------------------------------------------------------------------
CREATE TABLE dbo.recipes (
    id                  UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_recipes_id DEFAULT NEWSEQUENTIALID(),
    user_id             UNIQUEIDENTIFIER NOT NULL,
    name                NVARCHAR(200)    NOT NULL,
    description         NVARCHAR(2000)   NULL,
    -- Compartilhamento com a equipe (Fase 11). Por padrao, privada.
    is_shared           BIT              NOT NULL CONSTRAINT DF_recipes_is_shared DEFAULT 0,
    current_version_id  UNIQUEIDENTIFIER NULL,
    created_at          DATETIME2(3)     NOT NULL CONSTRAINT DF_recipes_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2(3)     NOT NULL CONSTRAINT DF_recipes_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_recipes PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_recipes_user FOREIGN KEY (user_id) REFERENCES dbo.users (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX UX_recipes_user_name ON dbo.recipes (user_id, name);

CREATE TABLE dbo.recipe_versions (
    id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_recipe_versions_id DEFAULT NEWSEQUENTIALID(),
    recipe_id      UNIQUEIDENTIFIER NOT NULL,
    version_number INT              NOT NULL,
    -- O documento da receita (passos + metricas), validado pelo schema Zod
    -- antes de chegar aqui.
    definition     NVARCHAR(MAX)    NOT NULL,
    created_by     UNIQUEIDENTIFIER NULL,
    created_at     DATETIME2(3)     NOT NULL CONSTRAINT DF_recipe_versions_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_recipe_versions PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_recipe_versions_recipe FOREIGN KEY (recipe_id) REFERENCES dbo.recipes (id) ON DELETE CASCADE,
    CONSTRAINT CK_recipe_versions_json CHECK (ISJSON(definition) = 1)
);

CREATE UNIQUE INDEX UX_recipe_versions_recipe_number ON dbo.recipe_versions (recipe_id, version_number);

ALTER TABLE dbo.recipes
    ADD CONSTRAINT FK_recipes_current_version
    FOREIGN KEY (current_version_id) REFERENCES dbo.recipe_versions (id);

-- ---------------------------------------------------------------------------
-- Execucoes (historico)
-- ---------------------------------------------------------------------------
-- ON DELETE NO ACTION nas FKs: apagar um dataset nao pode apagar o historico
-- de que ele foi processado. Guardamos o nome do arquivo desnormalizado para
-- o historico continuar legivel depois que o dataset expira.
-- ---------------------------------------------------------------------------
CREATE TABLE dbo.executions (
    id                 UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_executions_id DEFAULT NEWSEQUENTIALID(),
    user_id            UNIQUEIDENTIFIER NOT NULL,
    dataset_id         UNIQUEIDENTIFIER NULL,
    dataset_name       NVARCHAR(400)    NOT NULL,
    recipe_id          UNIQUEIDENTIFIER NULL,
    recipe_version_id  UNIQUEIDENTIFIER NULL,
    recipe_name        NVARCHAR(200)    NULL,
    -- Snapshot da receita exatamente como executada. Torna a execucao
    -- reproduzivel mesmo que a receita seja alterada ou excluida depois.
    definition         NVARCHAR(MAX)    NOT NULL,
    status             VARCHAR(20)      NOT NULL CONSTRAINT DF_executions_status DEFAULT 'queued',
    input_row_count    INT              NOT NULL CONSTRAINT DF_executions_input DEFAULT 0,
    output_row_count   INT              NOT NULL CONSTRAINT DF_executions_output DEFAULT 0,
    duration_ms        INT              NOT NULL CONSTRAINT DF_executions_duration DEFAULT 0,
    error_message      NVARCHAR(2000)   NULL,
    result_path        NVARCHAR(500)    NULL,
    created_at         DATETIME2(3)     NOT NULL CONSTRAINT DF_executions_created_at DEFAULT SYSUTCDATETIME(),
    completed_at       DATETIME2(3)     NULL,
    CONSTRAINT PK_executions PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_executions_user FOREIGN KEY (user_id) REFERENCES dbo.users (id),
    CONSTRAINT FK_executions_dataset FOREIGN KEY (dataset_id) REFERENCES dbo.datasets (id),
    CONSTRAINT FK_executions_recipe FOREIGN KEY (recipe_id) REFERENCES dbo.recipes (id),
    CONSTRAINT CK_executions_status CHECK (status IN ('queued','running','succeeded','failed')),
    CONSTRAINT CK_executions_json CHECK (ISJSON(definition) = 1)
);

CREATE INDEX IX_executions_user_created ON dbo.executions (user_id, created_at DESC);
CREATE INDEX IX_executions_dataset ON dbo.executions (dataset_id);

CREATE TABLE dbo.execution_metrics (
    id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_execution_metrics_id DEFAULT NEWSEQUENTIALID(),
    execution_id  UNIQUEIDENTIFIER NOT NULL,
    metric_key    NVARCHAR(64)     NOT NULL,
    label         NVARCHAR(200)    NOT NULL,
    operation     VARCHAR(30)      NOT NULL,
    column_name   NVARCHAR(255)    NULL,
    -- NULL e um resultado legitimo: a media de um conjunto vazio nao e zero.
    value         DECIMAL(38,10)   NULL,
    format        VARCHAR(20)      NULL,
    CONSTRAINT PK_execution_metrics PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_execution_metrics_execution FOREIGN KEY (execution_id) REFERENCES dbo.executions (id) ON DELETE CASCADE
);

CREATE INDEX IX_execution_metrics_execution ON dbo.execution_metrics (execution_id);

-- ---------------------------------------------------------------------------
-- Exportacoes
-- ---------------------------------------------------------------------------
CREATE TABLE dbo.exports (
    id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_exports_id DEFAULT NEWSEQUENTIALID(),
    user_id       UNIQUEIDENTIFIER NOT NULL,
    execution_id  UNIQUEIDENTIFIER NULL,
    filename      NVARCHAR(400)    NOT NULL,
    format        VARCHAR(10)      NOT NULL,
    size_bytes    BIGINT           NOT NULL CONSTRAINT DF_exports_size DEFAULT 0,
    storage_path  NVARCHAR(500)    NOT NULL,
    row_count     INT              NOT NULL CONSTRAINT DF_exports_row_count DEFAULT 0,
    download_count INT             NOT NULL CONSTRAINT DF_exports_downloads DEFAULT 0,
    created_at    DATETIME2(3)     NOT NULL CONSTRAINT DF_exports_created_at DEFAULT SYSUTCDATETIME(),
    expires_at    DATETIME2(3)     NULL,
    CONSTRAINT PK_exports PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_exports_user FOREIGN KEY (user_id) REFERENCES dbo.users (id) ON DELETE CASCADE,
    CONSTRAINT FK_exports_execution FOREIGN KEY (execution_id) REFERENCES dbo.executions (id),
    CONSTRAINT CK_exports_format CHECK (format IN ('xlsx','csv'))
);

CREATE INDEX IX_exports_user_created ON dbo.exports (user_id, created_at DESC);
CREATE INDEX IX_exports_expires ON dbo.exports (expires_at) WHERE expires_at IS NOT NULL;
