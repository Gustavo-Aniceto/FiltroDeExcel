-- ============================================================================
-- 0001 - Autenticacao, sessoes e auditoria
-- ============================================================================
-- Convencoes adotadas em todo o esquema:
--   * PK UNIQUEIDENTIFIER com DEFAULT NEWSEQUENTIALID(). GUIDs aleatorios como
--     chave clusterizada causam fragmentacao severa de indice; a variante
--     sequencial evita isso mantendo o ID opaco na API.
--   * DATETIME2(3) sempre em UTC (SYSUTCDATETIME). Fuso e problema da camada
--     de apresentacao, nunca do armazenamento.
--   * NVARCHAR para texto de usuario (acentos, nomes de coluna em portugues).
-- ============================================================================

CREATE TABLE dbo.users (
    id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_users_id DEFAULT NEWSEQUENTIALID(),
    email           NVARCHAR(320)    NOT NULL,
    password_hash   NVARCHAR(255)    NOT NULL,
    display_name    NVARCHAR(120)    NOT NULL,
    role            VARCHAR(20)      NOT NULL CONSTRAINT DF_users_role DEFAULT 'user',
    is_active       BIT              NOT NULL CONSTRAINT DF_users_is_active DEFAULT 1,
    created_at      DATETIME2(3)     NOT NULL CONSTRAINT DF_users_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2(3)     NOT NULL CONSTRAINT DF_users_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_users PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_users_role CHECK (role IN ('admin', 'user'))
);

-- E-mail e case-insensitive na pratica; a API normaliza para minusculas antes
-- de gravar, e este indice unico garante a regra tambem no banco.
CREATE UNIQUE INDEX UX_users_email ON dbo.users (email);

-- ---------------------------------------------------------------------------
-- Refresh tokens
-- ---------------------------------------------------------------------------
-- Guardamos apenas o SHA-256 do token, nunca o valor em si: um vazamento do
-- banco nao concede sessoes.
--
-- `family_id` implementa deteccao de reuso. Cada rotacao cria um token novo na
-- mesma familia. Se um token JA ROTACIONADO for apresentado de novo, significa
-- que alguem capturou um token antigo -- e revogamos a familia inteira.
-- ---------------------------------------------------------------------------
CREATE TABLE dbo.refresh_tokens (
    id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_refresh_tokens_id DEFAULT NEWSEQUENTIALID(),
    user_id       UNIQUEIDENTIFIER NOT NULL,
    token_hash    BINARY(32)       NOT NULL,
    family_id     UNIQUEIDENTIFIER NOT NULL,
    expires_at    DATETIME2(3)     NOT NULL,
    revoked_at    DATETIME2(3)     NULL,
    used_at       DATETIME2(3)     NULL,
    user_agent    NVARCHAR(400)    NULL,
    ip_address    VARCHAR(45)      NULL,
    created_at    DATETIME2(3)     NOT NULL CONSTRAINT DF_refresh_tokens_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_refresh_tokens PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES dbo.users (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX UX_refresh_tokens_hash ON dbo.refresh_tokens (token_hash);
CREATE INDEX IX_refresh_tokens_user ON dbo.refresh_tokens (user_id, expires_at);
CREATE INDEX IX_refresh_tokens_family ON dbo.refresh_tokens (family_id);

-- ---------------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------------
-- BIGINT IDENTITY: tabela de escrita intensa e append-only, onde ordem de
-- insercao e o padrao de leitura dominante.
--
-- `user_id` NAO tem FK para users: um log de auditoria precisa sobreviver a
-- exclusao do usuario, senao perde exatamente o registro que mais importa.
-- ---------------------------------------------------------------------------
CREATE TABLE dbo.audit_logs (
    id            BIGINT           NOT NULL IDENTITY(1,1),
    user_id       UNIQUEIDENTIFIER NULL,
    action        VARCHAR(60)      NOT NULL,
    entity_type   VARCHAR(40)      NULL,
    entity_id     NVARCHAR(100)    NULL,
    ip_address    VARCHAR(45)      NULL,
    user_agent    NVARCHAR(400)    NULL,
    -- JSON com contexto adicional. NUNCA conteudo de planilha nem segredos.
    metadata      NVARCHAR(MAX)    NULL,
    created_at    DATETIME2(3)     NOT NULL CONSTRAINT DF_audit_logs_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_audit_logs PRIMARY KEY CLUSTERED (id)
);

CREATE INDEX IX_audit_logs_user_created ON dbo.audit_logs (user_id, created_at DESC);
CREATE INDEX IX_audit_logs_created ON dbo.audit_logs (created_at DESC);
