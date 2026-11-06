# AutoClip Landing Premium 2.0 — Design Spec

## 1. Objetivo de experiência

Reposicionar a landing como uma apresentação editorial de um SaaS de operação TikTok. A página deve vender clareza e controle: headline forte, demonstração ampla, explicação progressiva e poucos elementos simultâneos. O resultado deve parecer um produto comercial, não uma sequência de painéis administrativos em miniatura.

## 2. Referência visual analisada

Não encontrei uma captura específica anexada pelo proprietário como referência da rejeição. Usei como registro do estado rejeitado as capturas completas da homologação anterior em `/tmp/autoclip-landing-phase4/after/1440x900.png` e `390x844.png`.

Nessas capturas, o problema é estrutural: o primeiro viewport divide a atenção entre texto e um preview pequeno; as seções de recursos e processo repetem painéis/cartões com tipografia densa; quase todo conteúdo está centralizado dentro de superfícies; planos e CTA final parecem cartões isolados. A versão 2 muda a composição, ordem e densidade, sem tentar resolver isso com apenas ajustes de escala.

## 3. Princípios de composição

- Usar alinhamento editorial à esquerda para títulos e descrições; reservar centralização para momentos curtos de foco.
- Alternar seções de texto e demonstração entre esquerda e direita.
- Usar espaço negativo como separação intencional, com limite de leitura por coluna.
- Mostrar uma interface ampla e coerente no Hero, em vez de vários mini dashboards.
- Limitar demonstrações a poucos dados legíveis e marcá-las como ilustrativas.
- Dar linguagem visual própria a cada seção; não repetir o mesmo cartão/superfície.
- Usar violeta para ação e foco, não como preenchimento dominante.

## 4. Hierarquia de página

1. **Header** — faixa de navegação editorial com 76 px aproximados, logo à esquerda, links Recursos / Como funciona / Planos / FAQ, login discreto e Criar conta destacado. Sticky no topo com fundo grafite opaco e borda inferior fina.
2. **Hero** — alinhado ao container e predominantemente à esquerda; eyebrow curto “UMA PLATAFORMA. TODAS AS SUAS CONTAS.”; H1 “Seu TikTok organizado. Seu tempo de volta.”; resumo de uma ou duas linhas; CTAs Criar conta e Explorar recursos.
3. **Demonstração principal** — preview amplo logo abaixo do texto do Hero, em uma moldura horizontal de produto. Desktop: rail lateral de contas e área principal de calendário/itens agendados. Mobile: transformação em uma sequência vertical resumida. Um rótulo discreto informa “Prévia ilustrativa · dados demonstrativos”.
4. **Contas e grupos** — seção editorial em duas colunas, demonstração grande ao lado do texto. Visual simples de lista de canais e agrupamento, sem miniaturizar conteúdo.
5. **Agendamento em lote** — ordem invertida. Visual de uma fila/linha do tempo de conteúdos, com poucos itens legíveis e indicação das etapas de revisão/confirmação.
6. **Formatos e acompanhamento** — composição horizontal mais aberta com dois focos: formatos de mídia e estados do histórico. Diferente dos mockups anteriores; mostrar a limitação Direct Post/Inbox em texto legível.
7. **Como funciona** — trilha numerada contínua (01 conectar, 02 preparar, 03 agendar e acompanhar), com linha visual e descrições curtas; sem três cartões de dashboard.
8. **Planos e disponibilidade** — seção de largura ampla, alinhada à esquerda, com disponibilidade/pricing transparentes, limites por workspace e CTA. Sem card único flutuante nem valores não aprovados.
9. **FAQ** — desktop em duas colunas: introdução e título à esquerda, accordion nativo à direita; mobile em coluna única. Preservar as dez perguntas e a precisão atual das respostas.
10. **CTA de fechamento** — faixa de alto contraste, com copy à esquerda e ação à direita em telas largas; bloco empilhado no mobile.
11. **Footer** — marca/descrição e colunas Navegação / Documentos / Privacidade, com e-mail confirmado apenas sob a função de contato de privacidade.

## 5. Componentes propostos

- `LandingHeader`: navegação desktop, painel mobile com Escape e restauração de foco.
- `ProductPreview`: única moldura principal do Hero, com conteúdo sintético, responsivo e acessível.
- `EditorialFeature`: seção de feature com ordem alternável e relação texto/demonstração.
- `FormatStatusShowcase`: apresentação conjunta de vídeo/fotos e histórico; sem prometer publicação garantida.
- `ProcessRail`: sequência horizontal no desktop e vertical no mobile.
- `AvailabilitySection`: copy comercial curta, sem preço/trial presumidos.
- `FaqSection`: `<details>/<summary>` com as dez respostas já fundamentadas.
- `FinalCallToAction` e `LandingFooter`.

Os componentes podem permanecer no arquivo atual `LandingPage.tsx` se isso deixar a implementação mais simples; não extrair abstrações sem reutilização demonstrada.

## 6. Tokens visuais exclusivos da landing

Escopo CSS: `.landing-v2`; nada global além do CSS base já compartilhado deve ser alterado.

| Token | Direção |
|---|---|
| `--lp-bg` | carvão frio `#0b0c10` |
| `--lp-bg-raised` | grafite `#111319` |
| `--lp-surface` | ardósia escura `#171922` |
| `--lp-border` | branco em ~8% |
| `--lp-text` | quase branco `#f4f5f8` |
| `--lp-muted` | cinza claro `#a6aab5` |
| `--lp-accent` | lavanda/violeta moderado `#a78bfa` |
| `--lp-accent-strong` | violeta `#8b6fe8` |
| `--lp-focus` | lavanda clara `#c4b5fd` |

Escala: container máximo 1240 px; gutters 24 px desktop, 20 px tablet, 18 px mobile; seção vertical `clamp(80px, 10vw, 144px)`; raio de controle 12 px, superfícies 18 px, moldura principal 26 px. Sombra difusa e curta apenas para preview/header. Sem glow de fundo pesado.

## 7. Tipografia

Manter Geist Variable e preload local existente. H1 com `clamp(3rem, 7.1vw, 6.4rem)`, peso 550–620, line-height ~0.98, largura 12–14ch. Títulos de seção 40–56 px com line-height 1.05; corpo de destaque 18–20 px e largura máxima 62ch; corpo comum 16–17 px / line-height 1.65; labels 12–13 px em caixa alta apenas quando informativos. Evitar texto funcional dentro de mockups abaixo de 13 px.

## 8. Botões e interação

- CTA primário: preenchimento violeta sóbrio, altura mínima 48 px, texto escuro de contraste validado, raio 10 px.
- CTA secundário: transparente com borda discreta; não competir com o primário.
- Foco 3 px com offset; hover por mudança pequena de superfície/borda; active por leve deslocamento/escurecimento, sem escala/glow.
- Todos os links de navegação e ações com alvos de pelo menos 44 px.
- Menu mobile fecha ao navegar ou pressionar Escape e devolve foco ao trigger.
- Respeitar `prefers-reduced-motion` e evitar animações de entrada que movam grandes blocos.

## 9. Responsividade

- **≤ 479 px:** header logo + trigger; Hero em coluna; H1 46–58 px sem quebras rígidas; preview vira feed empilhado e pode ocultar detalhes secundários decorativos, nunca o rótulo de demonstração ou o propósito.
- **480–767 px:** gutters 20–24 px; previews mantêm conteúdo vertical, sem colunas internas comprimidas.
- **768–1023 px:** features ainda em coluna/alternância moderada; não ativar layouts internos que exijam largura desktop. FAQ mantém duas colunas só se cada coluna comportar texto sem cortes.
- **1024–1439 px:** composições de duas colunas com gap generoso; Hero continua textual e apoiado pela moldura ampla abaixo.
- **≥1440 px:** largura máxima 1240 px; expansão de espaço externo, não de largura de linha; CTA final e demos têm teto de largura.
- Validar em 360×800, 390×844, 768×1024, 1024×768, 1440×900 e 1920×1080.

## 10. Conteúdo e precisão do produto

Manter `/cadastro` como destino principal. Recursos podem descrever organização de canais/grupos, planejamento individual e em lote, vídeos e fotos/carrosséis nos modos compatíveis, e acompanhamento no histórico. Informar que fotos/carrosséis exigem Direct Post e permissões do TikTok; Inbox no fluxo atual aceita apenas vídeos e requer conclusão pelo usuário. Não prometer publicação garantida, TikTok Shop, trial, preços públicos, métricas, clientes ou resultados.

## 11. SEO, privacidade e limites de escopo

- Preservar `noindex` global, canonical, Open Graph, Twitter Card, idioma, favicon e preload da Geist.
- Não alterar rotas de Auth, cadastro, OAuth nem páginas legais.
- Não alterar AuthProvider, dados remotos, backend, feature flags, billing ou integrações.
- Dados de todas as demonstrações são sintéticos e explicitamente rotulados.

## 12. Plano de implementação e validação

1. Substituir a hierarquia visual do `LandingPage.tsx`, preservando perguntas/respostas, textos factuais e destinos.
2. Recriar estilos no escopo `.landing-v2` dentro de `index.css`; não alterar tokens do dashboard.
3. Rodar typecheck, build, Vitest e `git diff --check`.
4. Capturar screenshots completos nos seis viewports e revisar visualmente.
5. Testar dimensões sem overflow, estados de menu, foco, Escape, FAQ por teclado, CTAs, cadastro e rotas de documentos.
6. Confirmar que preload da Geist resolve no `dist` e que apenas arquivos da landing/spec foram alterados.
7. Registrar commit local na branch v2; não fazer push nem atualizar PR #4.

## 13. Riscos e limitações

- Não há uma captura de rejeição fornecida pelo proprietário; as capturas locais anteriores são uma referência aproximada do que foi rejeitado.
- Sem captura real sanitizada do dashboard, a demo será uma ilustração com dados demonstrativos.
- Preços/condições seguem sem aprovação e continuam transparentes, sem preço inventado.
- `noindex` permanece; o redesign não habilita indexação.
- Validação local não confirma estado visual ou funcional da Production.
