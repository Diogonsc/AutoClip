# Inventário de Storage e mídias Cloud

**Estado: não consultado.** Alvo provável `Autoclip` / `djrwfvcxgpyknmizqumn`, ambiente produção/staging ainda não confirmado. Não foram listados buckets, objetos ou registros de mídia Cloud; nenhum arquivo foi baixado, URL assinada gerada, ou metadado remoto alterado.

## Contrato local esperado (fonte: migrations)

- Bucket `media`: armazenamento definitivo declarado privado e para mídia validada; acesso direto de escrita do cliente foi removido no pipeline seguro.
- Bucket `media-quarantine`: declarado privado, até 50 MiB e restrito a formatos conhecidos no SQL local.
- `media_assets` guarda estado de validação, chave, checksum e metadados. Migrations marcam legado anterior como `UNVERIFIED`, preservando registros e referências.
- O gate de upload requer objeto de quarentena e tamanho compatível antes do claim; o worker deve validar e promover antes de `READY/VALIDATED`.

Essas são expectativas da fonte local, não configuração comprovada do projeto remoto.

## Inventário remoto pendente

| Bucket | Privacidade | Objetos | Volume estimado | Conteúdo acessado | Estado |
|---|---|---:|---:|---|---|
| `media` | Não verificado | Não verificado | Não verificado | Não | Auditoria Cloud pendente |
| `media-quarantine` | Não verificado | Não verificado | Não verificado | Não | Auditoria Cloud pendente |

## Mídia legada

Quantidades por workspace/status/MIME, hashes presentes, jobs ligados, reservas e objetos ausentes são **não verificados na Cloud**. Não iniciar revalidação, alterar READY, reativar jobs, liberar reservas ou excluir objetos nesta fase. A futura coleta deve agregar por workspace pseudonimizado e omitir nomes/caminhos, sem download binário nem signed URLs.
