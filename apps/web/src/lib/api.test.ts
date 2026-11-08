import { describe, expect, it } from "vitest";
import { toFunctionError } from "./api";

describe("toFunctionError", () => {
  it("uses the controlled HTTP response message", async () => {
    const error = {
      name: "FunctionsHttpError",
      context: new Response(JSON.stringify({ error: "forbidden", message: "Acesso restrito." })),
    };
    await expect(toFunctionError(error)).resolves.toMatchObject({
      message: "Acesso restrito.",
      code: "forbidden",
    });
  });

  it("maps unauthenticated and unauthorized responses", async () => {
    await expect(
      toFunctionError({ context: new Response(JSON.stringify({ error: "unauthorized" })) }),
    ).resolves.toMatchObject({ message: "Sessão expirada. Entre novamente.", code: "unauthorized" });
    await expect(
      toFunctionError({ context: new Response(JSON.stringify({ error: "forbidden" })) }),
    ).resolves.toMatchObject({ message: "Você não tem permissão para esta ação.", code: "forbidden" });
  });

  it("does not call json when context is not a Response", async () => {
    await expect(
      toFunctionError({ name: "FunctionsRelayError", context: { status: 502 } }),
    ).resolves.toMatchObject({
      message: "O serviço não conseguiu encaminhar a solicitação. Tente novamente em instantes.",
    });
  });

  it("handles network, empty, and invalid JSON responses safely", async () => {
    await expect(toFunctionError({ name: "FunctionsFetchError" })).resolves.toMatchObject({
      message: "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.",
    });
    await expect(toFunctionError({ context: new Response("", { status: 500 }) })).resolves.toMatchObject({
      message: "Não foi possível concluir a operação. Tente novamente.",
    });
    await expect(toFunctionError({ context: new Response("not json", { status: 500 }) })).resolves.toMatchObject({
      message: "Não foi possível concluir a operação. Tente novamente.",
    });
    await expect(toFunctionError(new Error("unexpected implementation detail"))).resolves.toMatchObject({
      message: "Não foi possível concluir a operação. Tente novamente.",
    });
  });
});
