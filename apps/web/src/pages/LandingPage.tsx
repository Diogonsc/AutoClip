import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  CalendarClock,
  CalendarDays,
  Clapperboard,
  FileVideo,
  Layers,
  Layers3,
  Menu,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import "./LandingPage.css";

const features = [
  {
    icon: CalendarClock,
    title: "Publique no momento certo",
    text: "Organize vídeos, carrosséis e aprovações em um calendário claro para o seu time.",
  },
  {
    icon: FileVideo,
    title: "Biblioteca que acompanha o ritmo",
    text: "Centralize mídia, legendas e versões para encontrar o conteúdo certo sem perder tempo.",
  },
  {
    icon: Layers3,
    title: "Fluxo de revisão simples",
    text: "Envie links de aprovação e mantenha clientes, criadores e equipe alinhados antes de publicar.",
  },
  {
    icon: UsersRound,
    title: "Um espaço por operação",
    text: "Separe canais, membros e permissões por workspace, sem abrir mão da visibilidade.",
  },
  {
    icon: ShieldCheck,
    title: "Feito para publicar com segurança",
    text: "Estados de aprovação, registros de eventos e revalidações protegem cada agendamento.",
  },
];

const plans = [
  {
    name: "Essencial",
    description: "Para quem está organizando a primeira operação de conteúdo.",
    price: "Em breve",
    items: [
      "1 workspace",
      "Biblioteca de mídia",
      "Calendário de publicações",
      "1 canal TikTok",
    ],
    featured: false,
  },
  {
    name: "Pro",
    description: "Para criadores e times que publicam com consistência.",
    price: "Em breve",
    items: [
      "Tudo do Essencial",
      "Aprovação de cliente",
      "Múltiplos canais",
      "Relatórios operacionais",
    ],
    featured: true,
  },
  {
    name: "Scale",
    description: "Para operações, agências e equipes que precisam de controle.",
    price: "Sob consulta",
    items: [
      "Tudo do Pro",
      "Workspaces e membros",
      "Papéis e permissões",
      "Onboarding dedicado",
      "Suporte prioritário",
    ],
    featured: false,
  },
];

export default function LandingPage() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <main className="landing-cinematic min-h-screen overflow-x-hidden bg-[#090711] text-[#f8f7fc]">
      <div className="cinematic-atmosphere" aria-hidden="true" />
      <header className="cinematic-header relative z-20 mx-auto flex h-24 max-w-[1440px] items-center justify-between px-6 xl:px-10">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-inherit no-underline"
          onClick={close}
        >
          <span className="cinematic-logo-mark grid size-11 place-items-center rounded-2xl text-[#160d29]">
            <Clapperboard className="size-6" />
          </span>
          <span className="font-heading text-xl font-semibold tracking-[-.04em] text-white sm:text-2xl">
            AutoClip
          </span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-[#c7c2d4] lg:flex">
          <a href="#recursos">Recursos</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#planos">Planos</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="hidden items-center gap-4 lg:flex">
          <Button variant="ghost" className="text-[#e7e2f0] hover:bg-white/8 hover:text-white" asChild>
            <Link to="/login">Entrar</Link>
          </Button>
          <Button className="cinematic-header-cta" asChild>
            <Link to="/cadastro">
              Criar conta <ArrowRight className="ml-1.5 size-4" />
            </Link>
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-white lg:hidden"
          onClick={() => setOpen(!open)}
          aria-label="Abrir menu"
        >
          {open ? <X /> : <Menu />}
        </Button>
        {open && (
          <nav className="absolute top-20 right-5 left-5 grid gap-2 rounded-2xl border border-white/10 bg-[#17101f]/95 p-4 shadow-2xl backdrop-blur-xl lg:hidden">
            <a href="#recursos" onClick={close}>
              Recursos
            </a>
            <a href="#como-funciona" onClick={close}>
              Como funciona
            </a>
            <a href="#planos" onClick={close}>
              Planos
            </a>
            <a href="#faq" onClick={close}>
              FAQ
            </a>
            <Button asChild className="mt-2">
              <Link to="/cadastro">Começar agora</Link>
            </Button>
          </nav>
        )}
      </header>

      <section className="cinematic-hero relative mx-auto grid max-w-[1440px] items-center px-6 pb-24 pt-12 xl:grid-cols-[.98fr_1.02fr] xl:px-10 xl:pb-28 xl:pt-20">
        <div className="cinematic-copy relative z-10 max-w-[680px]">
          <div className="cinematic-eyebrow">
            <span /> UMA PLATAFORMA. TODAS AS SUAS CONTAS.
          </div>
          <h1 className="cinematic-title font-heading">
            Seu TikTok organizado.
            <br />
            <span>Seu tempo de volta.</span>
          </h1>
          <p className="cinematic-description">
            Gerencie múltiplas contas TikTok, organize vídeos e carrosséis e
            planeje publicações em lote em um só lugar.
          </p>
          <div className="cinematic-benefits" aria-label="Principais benefícios">
            <span><CalendarDays /> Agendamento em lote</span>
            <span><Layers /> Múltiplas contas</span>
            <span><BarChart3 /> Gestão e relatórios</span>
          </div>
          <div className="cinematic-actions">
            <Button size="lg" className="cinematic-primary" asChild>
              <Link to="/cadastro">
                Criar conta <ArrowRight className="ml-2 size-5" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="cinematic-secondary"
              asChild
            >
              <a href="#recursos">
                Explorar recursos <ArrowUpRight className="ml-2 size-4" />
              </a>
            </Button>
          </div>
        </div>
        <HeroPanel />
      </section>

      <section
        id="recursos"
        className="relative border-y border-white/7 bg-white/[.025]"
      >
        <div className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-[#b4a0ff]">
              UMA OPERAÇÃO, UM LUGAR
            </p>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">
              Da ideia à publicação, sem perder o fio.
            </h2>
            <p className="mt-4 text-[#aaa5b8]">
              Cada recurso existe para reduzir o atrito entre produzir, revisar,
              aprovar e colocar conteúdo no ar.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, text }) => (
              <article
                key={title}
                className="rounded-2xl border border-white/8 bg-[#15151e]/80 p-6 transition hover:-translate-y-1 hover:border-[#8f78d0]/35"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-[#8f78d0]/14 text-[#b4a0ff]">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-5 font-heading text-lg font-medium text-white">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#aaa5b8]">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="como-funciona"
        className="relative mx-auto max-w-7xl px-5 py-24 lg:px-8"
      >
        <div className="grid gap-12 lg:grid-cols-[.85fr_1.15fr]">
          <div>
            <p className="text-sm font-medium text-[#b4a0ff]">COMO FUNCIONA</p>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">
              Seu próximo post não deveria depender de planilhas e mensagens
              soltas.
            </h2>
            <p className="mt-5 text-[#aaa5b8]">
              Dê contexto para cada publicação e deixe que o AutoClipe cuide do
              caminho operacional.
            </p>
            <Button className="mt-7" variant="outline" asChild>
              <Link to="/cadastro">
                Criar meu workspace <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
          <ol className="grid gap-4">
            {[
              [
                "01",
                "Centralize",
                "Envie mídia, organize legendas e mantenha o material disponível para quem precisa criar.",
              ],
              [
                "02",
                "Planeje",
                "Defina canal, data, formato e responsável com uma visão única do calendário.",
              ],
              [
                "03",
                "Revise",
                "Peça aprovação antes do agendamento e mantenha o histórico da decisão registrado.",
              ],
              [
                "04",
                "Publique",
                "Envie vídeos e carrosséis ao TikTok e acompanhe o status da publicação.",
              ],
            ].map(([number, title, text]) => (
              <li
                key={number}
                className="grid grid-cols-[3.5rem_1fr] gap-4 rounded-2xl border border-white/8 bg-[#12121a] p-5"
              >
                <span className="font-heading text-lg text-[#8f78d0]">
                  {number}
                </span>
                <div>
                  <h3 className="font-medium text-white">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#aaa5b8]">
                    {text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="planos"
        className="relative border-y border-white/7 bg-[#13131c]"
      >
        <div className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
          <div className="text-center">
            <p className="text-sm font-medium text-[#b4a0ff]">PLANOS</p>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">
              Cresça no seu ritmo.
            </h2>
            <p className="mt-4 text-[#aaa5b8]">
              Escolha uma base para sua operação. Os valores finais serão
              divulgados no lançamento comercial.
            </p>
          </div>
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {plans.map((plan) => (
              <article
                key={plan.name}
                className={`rounded-2xl border p-7 ${plan.featured ? "border-[#8f78d0] bg-[#211b34] shadow-[0_18px_50px_rgba(0,0,0,.25)]" : "border-white/8 bg-[#171620]"}`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-heading text-xl font-semibold text-white">
                    {plan.name}
                  </h3>
                  {plan.featured && (
                    <span className="rounded-full bg-[#8f78d0] px-2.5 py-1 text-xs font-medium text-[#160f2a]">
                      Mais completo
                    </span>
                  )}
                </div>
                <p className="mt-3 min-h-12 text-sm leading-6 text-[#aaa5b8]">
                  {plan.description}
                </p>
                <p className="mt-7 font-heading text-3xl font-semibold text-white">
                  {plan.price}
                </p>
                <ul className="mt-7 grid gap-3 text-sm text-[#d0cbdc]">
                  {plan.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <BadgeCheck className="mt-0.5 size-4 shrink-0 text-[#b4a0ff]" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-8 w-full"
                  variant={plan.featured ? "default" : "outline"}
                  asChild
                >
                  <Link to="/cadastro">Quero conhecer</Link>
                </Button>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="relative mx-auto max-w-5xl px-5 py-24 lg:px-8">
        <div className="text-center">
          <p className="text-sm font-medium text-[#b4a0ff]">FAQ</p>
          <h2 className="mt-3 font-heading text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">
            Perguntas frequentes, respostas diretas.
          </h2>
        </div>
        <div className="mt-10 grid gap-3">
          {[
            ["Posso organizar mais de uma conta?", "Sim. O AutoClip foi pensado para centralizar a operação de múltiplas contas e canais em um só workspace."],
            ["O painel mostrado na hero é uma conta real?", "Não. O painel da hero é uma ilustração visual do produto e não exibe dados de clientes."],
            ["Como começo a usar?", "Crie sua conta para acessar o workspace e conhecer as opções disponíveis para a sua operação."],
          ].map(([question, answer]) => (
            <details key={question} className="group rounded-2xl border border-white/10 bg-white/[.025] px-6 py-5">
              <summary className="cursor-pointer list-none font-medium text-white marker:hidden">{question}<span className="float-right text-xl text-[#b979ff] transition-transform group-open:rotate-45">+</span></summary>
              <p className="mb-0 mt-4 max-w-3xl text-sm leading-6 text-[#b9b4c8]">{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section
        id="contato"
        className="relative mx-auto max-w-5xl px-5 py-24 text-center lg:px-8"
      >
        <div className="rounded-3xl border border-[#8f78d0]/25 bg-[linear-gradient(135deg,rgba(143,120,208,.2),rgba(31,25,48,.9))] px-6 py-14 sm:px-12">
          <Sparkles className="mx-auto size-6 text-[#b4a0ff]" />
          <h2 className="mt-5 font-heading text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">
            Conteúdo é criatividade. A operação pode ser simples.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-[#c0bbd0]">
            Crie seu workspace e veja como o AutoClipe pode dar previsibilidade
            para a sua rotina de publicação.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild>
              <Link to="/cadastro">
                Começar agora <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/15 bg-transparent text-white hover:bg-white/10"
              asChild
            >
              <a href="mailto:contato@AutoClipe.app">Falar com a equipe</a>
            </Button>
          </div>
        </div>
      </section>
      <footer className="relative border-t border-white/8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-[#9691a5] sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <span>
            © {new Date().getFullYear()} AutoClipe. Todos os direitos
            reservados.
          </span>
          <div className="flex flex-wrap gap-5">
            <a href="/privacy-policy.html">Privacidade</a>
            <a href="/terms-of-service.html">Termos de uso</a>
            <a href="/data-deletion.html">Exclusão de dados</a>
            <a href="/security-policy.html">Security Policy / Segurança</a>
            <Link to="/login">Entrar</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function HeroPanel() {
  return (
    <div className="device-image-stage">
      <img
        src="/autoclip-devices.png"
        width={1536}
        height={1024}
        alt="Ilustração do painel AutoClip em um notebook e smartphone"
        className="device-image"
        decoding="async"
      />
    </div>
  );
}
