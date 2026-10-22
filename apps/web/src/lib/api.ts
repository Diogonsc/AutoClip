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

function friendly(e: RawError): string {
  const m = e.message.toLowerCase();
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
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const j = (await ctx.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (j?.message) throw new ApiError(j.message, j.error);
      if (j?.error === "forbidden")
        throw new ApiError(
          "Você não tem permissão para esta ação.",
          "forbidden",
        );
      if (j?.error === "unauthorized")
        throw new ApiError("Sessão expirada. Entre novamente.", "unauthorized");
    }
    throw new ApiError(
      "Não foi possível concluir a operação. Tente novamente.",
    );
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Erro inesperado.";
}
