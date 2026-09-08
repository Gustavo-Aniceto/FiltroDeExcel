import { z } from 'zod';

export const USER_ROLES = ['admin', 'user'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Politica de senha: comprimento acima de tudo.
 *
 * Regras de composicao ("1 maiuscula, 1 simbolo") empurram usuarios para
 * "Senha@123" e reduzem a entropia real. O NIST SP 800-63B recomenda
 * priorizar tamanho minimo e bloquear senhas conhecidamente vazadas.
 */
export const passwordSchema = z
  .string()
  .min(10, 'A senha deve ter ao menos 10 caracteres')
  .max(200, 'A senha deve ter no maximo 200 caracteres');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('E-mail invalido')
  .max(320);

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2, 'Informe seu nome').max(120),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha').max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  role: z.enum(USER_ROLES),
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export interface AuthSessionResponse {
  user: PublicUser;
  accessToken: string;
  /** Segundos de validade do access token. */
  expiresIn: number;
}

/** Conteudo do JWT de acesso. O refresh token e opaco e nao carrega claims. */
export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}
