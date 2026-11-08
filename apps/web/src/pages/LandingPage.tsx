import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  CalendarDays,
  Check,
  ChevronDown,
  Clapperboard,
  Clock3,
  FileImage,
  Layers3,
  Menu,
  UsersRound,
  Video,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import "./LandingPage.css";

const faqs = [
  {
    question: "O que é o AutoClipe?",
    answer:
      "É uma plataforma para organizar canais TikTok, preparar conteúdos, planejar publicações e acompanhar seus estados em um workspace.",
  },
  {
    question: "Posso conectar várias contas TikTok?",
    answer:
      "O AutoClipe permite conectar canais ao workspace. A quantidade permitida depende dos limites aplicáveis ao plano e ao workspace; consulte a área Plano e consumo após entrar.",
  },
  {
    question: "É possível agendar publicações em lote?",
    answer:
      "Sim. Você pode montar um lote para canais e mídias, revisar as linhas e confirmar o agendamento. A confirmação depende da elegibilidade dos canais, das mídias e da quota disponível.",
  },
  {
    question: "O AutoClipe aceita vídeos e carrosséis?",
    answer:
      "O fluxo suporta vídeos e publicações de fotos. Fotos ou carrosséis exigem o modo Direct Post e as permissões necessárias do TikTok; no fluxo Inbox, o AutoClipe aceita apenas vídeos.",
  },
  {
    question: "Qual é a diferença entre Direct Post e Inbox?",
    answer:
      "No Direct Post, o AutoClipe solicita a publicação pela integração do TikTok, sujeita às permissões, capacidades da conta, opções de visibilidade disponíveis e regras da plataforma. No Inbox, o conteúdo é enviado como rascunho para você concluir no TikTok.",
  },
  {
    question: "Preciso autorizar minhas contas TikTok?",
    answer:
      "Sim. Para conectar um canal, você precisa autorizar a conta pelo fluxo de autorização do TikTok e conceder as permissões solicitadas para os recursos que pretende usar.",
  },
  {
    question: "Como acompanho minhas publicações?",
    answer:
      "A área de histórico mostra estados como agendada, em processamento, publicada, enviada ao Inbox, com falha ou aguardando alguma ação. O resultado também depende das respostas e capacidades do TikTok.",
  },
  {
    question: "Como funcionam os planos e limites?",
    answer:
      "Os limites de contas e publicações são aplicados por workspace e podem variar conforme o plano. Preços e condições comerciais ainda não estão confirmados para divulgação nesta página; não há promessa de teste grátis.",
  },
  {
    question: "O AutoClipe publica automaticamente em todos os casos?",
    answer:
      "Não. Uma publicação pode depender de autorização, permissões, capacidades da conta, configurações do workspace, validação da mídia e regras do TikTok. No Inbox, você finaliza a publicação no aplicativo TikTok.",
  },
  {
    question: "Como posso começar?",
    answer:
      "Use o botão Criar conta para abrir o cadastro. Depois de criar a conta, talvez seja necessário confirmar seu e-mail antes de entrar, conforme a configuração de autenticação.",
  },
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  return (
    <div className="landing-v2">
      <a className="lp-skip-link" href="#landing-main">
        Pular para o conteúdo
      </a>
      <div aria-hidden="true" className="lp-atmosphere" />

      <header className="lp-header">
        <div className="lp-container lp-header-inner">
          <Link
            aria-label="AutoClipe, página inicial"
            className="lp-brand"
            onClick={closeMenu}
            to="/"
          >
            <span aria-hidden="true" className="lp-brand-mark">
              <Clapperboard />
            </span>
            <span>AutoClipe</span>
          </Link>

          <nav aria-label="Navegação principal" className="lp-desktop-nav">
            <a href="#recursos">Recursos</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#planos">Planos</a>
            <a href="#faq">FAQ</a>
          </nav>

          <div className="lp-header-actions">
            <Link className="lp-login-link" to="/login">
              Entrar
            </Link>
            <Link className="lp-button lp-button-primary lp-header-cta" to="/cadastro">
              Criar conta <ArrowRight aria-hidden="true" />
            </Link>
          </div>

          <button
            ref={menuButtonRef}
            aria-controls="landing-v2-mobile-menu"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            className="lp-menu-trigger"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>

          <nav
            aria-label="Navegação móvel"
            className="lp-mobile-menu"
            hidden={!menuOpen}
            id="landing-v2-mobile-menu"
          >
            <a href="#recursos" onClick={closeMenu}>Recursos</a>
            <a href="#como-funciona" onClick={closeMenu}>Como funciona</a>
            <a href="#planos" onClick={closeMenu}>Planos</a>
            <a href="#faq" onClick={closeMenu}>Perguntas frequentes</a>
            <div className="lp-mobile-actions">
              <Link className="lp-button lp-button-secondary" onClick={closeMenu} to="/login">
                Entrar
              </Link>
              <Link className="lp-button lp-button-primary" onClick={closeMenu} to="/cadastro">
                Criar conta <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </nav>
        </div>
      </header>

      <main id="landing-main" tabIndex={-1}>
        <section aria-labelledby="lp-hero-title" className="lp-hero lp-container">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">
              <span aria-hidden="true" className="lp-eyebrow-rule" />
              Uma plataforma. Todas as suas contas.
            </p>
            <h1 id="lp-hero-title">
              Seu TikTok organizado.
              <span>Seu tempo de volta.</span>
            </h1>
            <p className="lp-hero-description">
              Gerencie múltiplas contas TikTok, organize vídeos e carrosséis e
              planeje publicações em lote em um só lugar.
            </p>
            <div className="lp-hero-actions">
              <Link className="lp-button lp-button-primary" to="/cadastro">
                Criar conta <ArrowRight aria-hidden="true" />
              </Link>
              <a className="lp-button lp-button-secondary" href="#recursos">
                Explorar recursos <ArrowUpRight aria-hidden="true" />
              </a>
            </div>
          </div>

          <ProductPreview />
        </section>

        <section aria-labelledby="lp-accounts-title" className="lp-editorial-section lp-container" id="recursos">
          <EditorialFeature
            description="Reúna seus canais TikTok no mesmo workspace e organize aqueles que fazem parte do mesmo fluxo de trabalho."
            eyebrow="01 / ORGANIZAÇÃO"
            title="Todas as suas contas. Uma operação mais simples."
            visual={<AccountsVisual />}
          />

          <EditorialFeature
            description="Prepare conteúdos para diferentes canais e horários. Revise cada linha antes de confirmar o agendamento em lote."
            eyebrow="02 / PLANEJAMENTO"
            reverse
            title="Agende em lote. Revise com clareza."
            visual={<BatchVisual />}
          />
        </section>

        <section aria-labelledby="lp-formats-title" className="lp-format-section">
          <div className="lp-container lp-format-layout">
            <div className="lp-format-intro">
              <p className="lp-eyebrow">03 / PUBLICAÇÃO E ACOMPANHAMENTO</p>
              <h2 id="lp-formats-title">Conteúdo preparado. Próxima etapa sempre clara.</h2>
              <p>
                Organize formatos compatíveis e acompanhe o estado de cada item
                no histórico de publicações.
              </p>
            </div>
            <div className="lp-format-showcase">
              <FormatsVisual />
              <StatusVisual />
            </div>
            <p className="lp-format-note">
              Fotos e carrosséis exigem Direct Post e permissões do TikTok. No
              fluxo Inbox, o AutoClipe aceita vídeos e você conclui a publicação
              no aplicativo TikTok.
            </p>
          </div>
        </section>

        <section aria-labelledby="lp-process-title" className="lp-process-section lp-container" id="como-funciona">
          <div className="lp-section-heading">
            <p className="lp-eyebrow">UM FLUXO, TRÊS ETAPAS</p>
            <h2 id="lp-process-title">Da conexão ao acompanhamento.</h2>
          </div>
          <ol className="lp-process-rail">
            <li>
              <span className="lp-step-number">01</span>
              <div>
                <h3>Conecte suas contas</h3>
                <p>Autorize os canais TikTok que farão parte do seu workspace.</p>
              </div>
            </li>
            <li>
              <span className="lp-step-number">02</span>
              <div>
                <h3>Prepare seus conteúdos</h3>
                <p>Escolha formatos, canais e horários para cada publicação.</p>
              </div>
            </li>
            <li>
              <span className="lp-step-number">03</span>
              <div>
                <h3>Agende e acompanhe</h3>
                <p>Revise o planejamento e acompanhe cada etapa no histórico.</p>
              </div>
            </li>
          </ol>
        </section>

        <section aria-labelledby="lp-plan-title" className="lp-availability-section" id="planos">
          <div className="lp-container lp-availability-layout">
            <div>
              <p className="lp-eyebrow">PLANOS E DISPONIBILIDADE</p>
              <h2 id="lp-plan-title">Organização que acompanha o seu workspace.</h2>
            </div>
            <div className="lp-availability-copy">
              <p>
                Os limites de contas e publicações variam conforme o plano e
                podem ser consultados na área Plano e consumo após entrar.
              </p>
              <p>
                Preços e condições comerciais ainda não estão aprovados para
                divulgação pública. Criar uma conta não promete período gratuito
                nem assinatura.
              </p>
              <Link className="lp-text-link" to="/cadastro">
                Conhecer o AutoClipe <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        <section aria-labelledby="lp-faq-title" className="lp-faq-section lp-container" id="faq">
          <div className="lp-faq-intro">
            <p className="lp-eyebrow">PERGUNTAS FREQUENTES</p>
            <h2 id="lp-faq-title">Antes de começar.</h2>
            <p>
              Respostas diretas sobre contas, formatos, agendamento e o que
              depende das permissões do TikTok.
            </p>
          </div>
          <div className="lp-faq-list">
            {faqs.map(({ question, answer }) => (
              <details key={question} className="lp-faq-item">
                <summary>
                  <span>{question}</span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="lp-close-title" className="lp-close-section lp-container" id="contato">
          <div className="lp-close-band">
            <div>
              <p className="lp-eyebrow">MENOS REPETIÇÃO. MAIS CLAREZA.</p>
              <h2 id="lp-close-title">Seu conteúdo merece uma operação mais simples.</h2>
            </div>
            <Link className="lp-button lp-button-primary" to="/cadastro">
              Criar conta <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}

function ProductPreview() {
  return (
    <figure aria-labelledby="lp-preview-caption" className="lp-product-figure">
      <figcaption className="lp-preview-caption" id="lp-preview-caption">
        <span aria-hidden="true" className="lp-preview-indicator" />
        Prévia ilustrativa <span>·</span> dados demonstrativos
      </figcaption>
      <div className="device-image-stage">
        <img
          alt="Ilustração do painel AutoClip em um notebook e smartphone"
          className="device-image"
          decoding="async"
          height={1024}
          src="/autoclip-devices.png"
          width={1536}
        />
      </div>
    </figure>
  );
}

function EditorialFeature({
  description,
  eyebrow,
  reverse = false,
  title,
  visual,
}: {
  description: string;
  eyebrow: string;
  reverse?: boolean;
  title: string;
  visual: ReactNode;
}) {
  return (
    <article className={`lp-feature-row${reverse ? " lp-feature-reverse" : ""}`}>
      <div className="lp-feature-copy">
        <p className="lp-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="lp-feature-visual">{visual}</div>
    </article>
  );
}

function AccountsVisual() {
  return (
    <div aria-label="Demonstração ilustrativa de canais e grupos" className="lp-accounts-visual">
      <div className="lp-visual-header">
        <span>Canais do workspace</span>
        <span>Exemplo</span>
      </div>
      <div aria-label="Canais de exemplo" className="lp-accounts-list" role="list">
        {[
          ["Conta de exemplo A", "Grupo de exemplo"],
          ["Conta de exemplo B", "Grupo de exemplo"],
          ["Conta de exemplo C", "Sem grupo"],
        ].map(([name, group], index) => (
          <div className="lp-account-line" key={name} role="listitem">
            <span className="lp-account-avatar">{String.fromCharCode(65 + index)}</span>
            <span className="lp-account-name">{name}</span>
            <span className="lp-account-group">{group}</span>
          </div>
        ))}
      </div>
      <div className="lp-account-group-summary">
        <span aria-hidden="true"><Layers3 /></span>
        <div>
          <strong>Grupo demonstrativo</strong>
          <p>Contas organizadas para um fluxo de trabalho.</p>
        </div>
        <ArrowUpRight aria-hidden="true" />
      </div>
    </div>
  );
}

function BatchVisual() {
  const items = [
    ["Vídeo", "Conta de exemplo A", "Revisar conteúdo"],
    ["Fotos", "Conta de exemplo B", "Conferir permissões"],
    ["Vídeo", "Conta de exemplo C", "Definir horário"],
  ];

  return (
    <div aria-label="Demonstração ilustrativa de planejamento em lote" className="lp-batch-visual">
      <div className="lp-batch-toolbar">
        <div>
          <p className="lp-micro-label">LOTE DEMONSTRATIVO</p>
          <strong>Revise o lote antes de agendar</strong>
        </div>
        <span className="lp-batch-toolbar-icon"><CalendarDays aria-hidden="true" /></span>
      </div>
      <div aria-label="Etapas do lote demonstrativo" className="lp-batch-list" role="list">
        {items.map(([format, channel, action], index) => (
          <div className="lp-batch-line" key={channel} role="listitem">
            <span aria-hidden="true" className="lp-batch-number">0{index + 1}</span>
            <span className="lp-batch-format">
              {format === "Vídeo" ? <Video aria-hidden="true" /> : <FileImage aria-hidden="true" />}
              {format}
            </span>
            <span className="lp-batch-channel">{channel}</span>
            <span className="lp-batch-action"><span aria-hidden="true" />{action}</span>
          </div>
        ))}
      </div>
      <div className="lp-batch-footer">
        <span><Check aria-hidden="true" /> Linhas revisadas antes de confirmar</span>
        <span>Exemplo visual</span>
      </div>
    </div>
  );
}

function FormatsVisual() {
  return (
    <div className="lp-format-media">
      <div className="lp-media-heading">
        <p className="lp-micro-label">FORMATOS</p>
        <span>Representação ilustrativa</span>
      </div>
      <div className="lp-media-options">
        <div className="lp-media-option lp-video-option">
          <span aria-hidden="true" className="lp-media-art lp-media-art-video"><Video /></span>
          <div><strong>Vídeos</strong><small>Prepare e organize cada publicação.</small></div>
          <span aria-hidden="true" className="lp-format-indicator">01</span>
        </div>
        <div className="lp-media-option lp-photo-option">
          <span aria-hidden="true" className="lp-media-art lp-media-art-photos"><FileImage /></span>
          <div><strong>Fotos e carrosséis</strong><small>Quando Direct Post e permissões permitem.</small></div>
          <span aria-hidden="true" className="lp-format-indicator">02</span>
        </div>
      </div>
    </div>
  );
}

function StatusVisual() {
  const steps = [
    ["Planejada", "Item adicionado ao fluxo"],
    ["Em processamento", "Aguardando resultado da plataforma"],
    ["Precisa de atenção", "Pode exigir uma ação adicional"],
  ];
  return (
    <div className="lp-status-visual">
      <div className="lp-status-heading">
        <p className="lp-micro-label">HISTÓRICO</p>
        <span>Exemplos de estados</span>
      </div>
      <ol>
        {steps.map(([title, note], index) => (
          <li key={title}>
            <span aria-hidden="true" className={`lp-status-icon lp-status-icon-${index}`}>
              {index === 0 ? <CalendarDays /> : index === 1 ? <Clock3 /> : <CircleAlert />}
            </span>
            <span><strong>{title}</strong><small>{note}</small></span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-container lp-footer-main">
        <div className="lp-footer-brand-block">
          <Link aria-label="AutoClipe, página inicial" className="lp-brand" to="/">
            <span aria-hidden="true" className="lp-brand-mark"><Clapperboard /></span>
            <span>AutoClipe</span>
          </Link>
          <p>Organize canais e publicações TikTok em um só lugar.</p>
        </div>
        <nav aria-label="Navegação do rodapé" className="lp-footer-column">
          <h2>Plataforma</h2>
          <a href="#recursos">Recursos</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#planos">Planos</a>
          <a href="#faq">Perguntas frequentes</a>
        </nav>
        <nav aria-label="Documentos legais" className="lp-footer-column">
          <h2>Documentos</h2>
          <a href="/terms-of-service.html">Termos de uso</a>
          <a href="/privacy-policy.html">Privacidade</a>
          <a href="/security-policy.html">Segurança</a>
          <a href="/data-deletion.html">Exclusão de dados</a>
        </nav>
        <div className="lp-footer-column lp-footer-contact">
          <h2>Privacidade</h2>
          <a href="mailto:diogos.nascimento@outlook.com?subject=Contato%20de%20privacidade%20%E2%80%94%20AutoClipe">
            Contato de privacidade <ArrowUpRight aria-hidden="true" />
          </a>
          <Link to="/login">Entrar</Link>
        </div>
      </div>
      <div className="lp-footer-bottom">
        <div className="lp-container">
          <span>© {new Date().getFullYear()} AutoClipe. Todos os direitos reservados.</span>
          <span>Feito para uma operação TikTok mais organizada.</span>
        </div>
      </div>
    </footer>
  );
}
