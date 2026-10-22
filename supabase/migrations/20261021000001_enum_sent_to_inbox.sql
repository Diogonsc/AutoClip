-- Novo estado terminal: o vídeo foi entregue à caixa de entrada do TikTok e
-- o criador ainda precisa concluir a publicação no app (modo INBOX).
-- Fica em arquivo próprio: um valor novo de enum não pode ser usado na mesma
-- transação em que foi criado.
alter type public.publication_status add value if not exists 'SENT_TO_INBOX';
