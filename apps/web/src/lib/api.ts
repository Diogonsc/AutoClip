export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

interface RawError {
  message: string;
  code?: string;
}

type EdgeErrorPayload = {
  error?: string;
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function friendly(e: RawError): string {
  const m = e.message.toLowerCase();
  if (m.includes("music_rights_consent_required"))
    return "Confirme os direitos/consentimento do áudio antes de agendar.";
  if (m.includes("tiktok_app_not_audited"))
    return "O aplicativo TikTok ainda não foi auditado. No modo DIRECT, selecione “Somente eu” ou altere para INBOX.";
  if (m.includes("client_approval_required"))
    return "Esta publicação precisa da aprovação do cliente antes de ser enviada.";
  if (m.includes("daily_channel_schedule_limit"))
    return "Este canal já tem 15 publicações agendadas para essa data local. Escolha outro dia ou horário.";
  if (m.includes("publication_quota_exceeded"))
    return "O limite de publicações do plano para este ciclo foi atingido.";
  if (m.includes("connected_channel_limit_exceeded"))
    return "O limite de contas TikTok conectadas do plano foi atingido.";
  if (m.includes("subscription is not active"))
    return "A assinatura deste workspace não está ativa para novas operações.";
  if (m.includes("not ready"))
    return "O vídeo ainda não está pronto (upload não finalizado).";
  if (m.includes("in the past")) return "A data de agendamento já passou.";
  if (m.includes("at least one owner"))
    return "O workspace precisa ter ao menos um proprietário.";
  if (m.includes("only owner"))
    return "Somente o proprietário pode fazer essa alteração.";
  if (m.includes("user not found"))
    return "Nenhum usuário cadastrado com esse e-mail.";
  switch (e.code) {
    case "42501":
      return "Você não tem permissão para esta ação.";
    case "23503":
      return "Este registro está vinculado a outros dados (ou a referência é inválida).";
    case "23505":
      return "Esse registro já existe.";
    default:
      return e.message;
  }
}

export function toError(e: RawError): ApiError {
  return new ApiError(friendly(e), e.code);
}

/** Lança erro amigável se a resposta do Supabase falhou; devolve os dados caso contrário. */
export function unwrap<T>(res: { data: T | null; error: RawError | null }): T {
  if (res.error) throw toError(res.error);
  return res.data as T;
}

/**
 * Converte erros de Edge Functions em mensagens seguras para a interface.
 * Nem todo erro do SDK possui `context` como um `Response`: relay e rede, por
 * exemplo, podem trazer outro objeto (ou nenhum). Por isso a leitura do corpo
 * é opcional e feita uma única vez.
 */
export async function toFunctionError(error: unknown): Promise<ApiError> {
  const record = isRecord(error) ? error : undefined;
  const context = record?.context;
  let payload: EdgeErrorPayload | null = null;

  if (isRecord(context) && typeof context.json === "function") {
    try {
      const body: unknown = await context.json();
      if (isRecord(body)) {
        payload = {
          error: typeof body.error === "string" ? body.error : undefined,
          message: typeof body.message === "string" ? body.message : undefined,
        };
      }
    } catch {
      // Respostas vazias, HTML de proxy e JSON inválido usam a mensagem segura abaixo.
    }
  }

  if (payload?.message) {
    return new ApiError(
      friendly({ message: payload.message, code: payload.error }),
      payload.error,
    );
  }
  if (payload?.error === "forbidden") {
    return new ApiError("Você não tem permissão para esta ação.", "forbidden");
  }
  if (payload?.error === "unauthorized") {
    return new ApiError("Sessão expirada. Entre novamente.", "unauthorized");
  }

  const name = typeof record?.name === "string" ? record.name : "";
  if (name === "FunctionsFetchError") {
    return new ApiError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
  }
  if (name === "FunctionsRelayError") {
    return new ApiError("O serviço não conseguiu encaminhar a solicitação. Tente novamente em instantes.");
  }
  if (name === "FunctionsHttpError") {
    return new ApiError("Não foi possível concluir a operação. Tente novamente.");
  }

  // Erros sem formato conhecido não são exibidos literalmente: podem conter
  // detalhes internos e não são úteis para quem usa a tela.
  return new ApiError("Não foi possível concluir a operação. Tente novamente.");
}

/** Chama uma Edge Function com o JWT do usuário e devolve o JSON; erros viram mensagem amigável. */
export async function invokeFunction<T>(
  client: {
    functions: {
      invoke: (
        name: string,
        opts: { body: Record<string, unknown> },
      ) => Promise<{ data: unknown; error: unknown }>;
    };
  },
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.functions.invoke(name, { body });
  if (error) {
    throw await toFunctionError(error);
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Erro inesperado.";
}
