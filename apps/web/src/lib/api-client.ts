import type { ApiErrorBody, ApiErrorDetail, ErrorCode } from '@excelflow/contracts';

/**
 * Erro de API que preserva codigo e detalhes por campo, para os formularios
 * conseguirem destacar exatamente o campo recusado pelo servidor.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ApiErrorDetail[];

  constructor(code: ErrorCode, message: string, status: number, details: ApiErrorDetail[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** Mensagem associada a um campo especifico, se houver. */
  detailFor(path: string): string | undefined {
    return this.details.find((d) => d.path === path)?.message;
  }
}

const BASE_URL = '/api/v1';

/**
 * O access token vive apenas em memoria -- deliberadamente.
 *
 * Guarda-lo em localStorage o expoe a qualquer XSS: um unico script injetado
 * le o storage e rouba a sessao. Mantido em memoria, ele morre ao recarregar a
 * pagina, e a sessao e reconstruida pelo cookie httpOnly de refresh, que o
 * JavaScript nao consegue ler. O custo e uma requisicao de refresh no boot.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Chamado quando a sessao se torna irrecuperavel; a camada de auth reage. */
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler = () => undefined;

export function setSessionExpiredHandler(handler: SessionExpiredHandler): void {
  onSessionExpired = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Interno: evita laco infinito de refresh. */
  skipRefresh?: boolean;
}

async function parseError(response: Response): Promise<ApiError> {
  let code: ErrorCode = 'INTERNAL_ERROR';
  let message = 'Nao foi possivel completar a operacao.';
  let details: ApiErrorDetail[] = [];

  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details ?? [];
    }
  } catch {
    // Resposta sem JSON (proxy fora do ar, 502 do gateway). Mantem o padrao.
  }

  return new ApiError(code, message, response.status, details);
}

/**
 * Refresh compartilhado.
 *
 * Se cinco requisicoes falharem com 401 ao mesmo tempo, todas devem aguardar
 * UM unico refresh. Sem esta promessa compartilhada, cinco refreshes
 * concorrentes disparariam a deteccao de reuso do backend e derrubariam a
 * sessao do usuario -- justamente o oposto do pretendido.
 */
let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        setAccessToken(null);
        return false;
      }
      const data = (await response.json()) as { accessToken: string };
      setAccessToken(data.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, skipRefresh = false } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const init: RequestInit = {
    method,
    headers,
    // Necessario para o cookie httpOnly de refresh acompanhar a requisicao.
    credentials: 'include',
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (signal) init.signal = signal;

  const response = await fetch(`${BASE_URL}${path}`, init);

  // 401 com token em maos significa access token expirado: renova uma vez e
  // repete a requisicao original. O usuario nunca percebe.
  if (response.status === 401 && !skipRefresh) {
    const renewed = await refreshSession();
    if (renewed) {
      return apiRequest<T>(path, { ...options, skipRefresh: true });
    }
    onSessionExpired();
    throw await parseError(response);
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  // 204 No Content nao tem corpo para desserializar.
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/**
 * Upload com progresso.
 *
 * Usamos XMLHttpRequest, e nao fetch: fetch ainda nao expoe progresso de
 * UPLOAD em nenhum navegador. Como uma planilha de 100 MB leva dezenas de
 * segundos, uma barra parada em "enviando..." faz o usuario achar que travou e
 * recarregar a pagina no meio do envio.
 */
export function uploadFile<T>(
  path: string,
  file: File,
  options: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);

    const request = new XMLHttpRequest();
    request.open('POST', `${BASE_URL}${path}`);
    request.withCredentials = true;
    if (accessToken) request.setRequestHeader('Authorization', `Bearer ${accessToken}`);

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && options.onProgress) {
        options.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.responseText ? (JSON.parse(request.responseText) as T) : (undefined as T));
        return;
      }

      let code: ErrorCode = 'INTERNAL_ERROR';
      let message = 'Nao foi possivel enviar o arquivo.';
      let details: ApiErrorDetail[] = [];
      try {
        const body = JSON.parse(request.responseText) as ApiErrorBody;
        if (body?.error) {
          code = body.error.code ?? code;
          message = body.error.message ?? message;
          details = body.error.details ?? [];
        }
      } catch {
        // Resposta sem JSON: mantem a mensagem padrao.
      }
      reject(new ApiError(code, message, request.status, details));
    });

    request.addEventListener('error', () =>
      reject(new ApiError('INTERNAL_ERROR', 'Falha de conexao durante o envio.', 0)),
    );
    request.addEventListener('abort', () =>
      reject(new ApiError('INTERNAL_ERROR', 'Envio cancelado.', 0)),
    );

    options.signal?.addEventListener('abort', () => request.abort());
    request.send(form);
  });
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    apiRequest<T>(path, { method: 'POST', body, signal }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
  /** Refresh explicito, usado na restauracao de sessao ao abrir o app. */
  tryRestoreSession: refreshSession,
};
