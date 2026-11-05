import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Check,
  CheckCircle2,
  Clapperboard,
  Clock3,
  Image as ImageIcon,
  Layers3,
  Menu,
  PlayCircle,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";

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
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <div className="landing-page min-h-screen overflow-x-hidden">
      <a className="landing-skip-link" href="#landing-main">
        Pular para o conteúdo
      </a>
      <div
        aria-hidden="true"
        className="landing-backdrop pointer-events-none fixed inset-0"
      />
      <header className="landing-header relative z-20 mx-auto flex min-h-16 max-w-7xl items-center justify-between border-b px-5 lg:px-8">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-inherit no-underline"
          onClick={close}
          aria-label="AutoClip, página inicial"
        >
          <span className="grid size-10 place-items-center rounded-xl bg-[#8f78d0] text-[#130f20]">
            <Clapperboard className="size-5" aria-hidden="true" />
          </span>
          <span className="font-heading text-lg font-semibold tracking-tight">
            AutoClip
          </span>
        </Link>
        <nav
          aria-label="Navegação principal"
          className="hidden items-center gap-6 text-sm text-[#c7c2d7] lg:flex"
        >
          <a href="#recursos">Recursos</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#planos">Planos</a>
          <a href="#contato">Contato</a>
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <Button variant="ghost" asChild>
            <Link to="/login">Entrar</Link>
          </Button>
          <Button className="landing-primary-cta" asChild>
            <Link to="/cadastro">
              Criar conta <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>
        <button
          ref={menuButtonRef}
          type="button"
          className="landing-menu-button grid size-11 place-items-center rounded-lg border border-white/10 text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b4a0ff] lg:hidden"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
          aria-controls="landing-mobile-navigation"
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
        <nav
          id="landing-mobile-navigation"
          aria-label="Navegação móvel"
          hidden={!open}
          className="landing-mobile-navigation absolute top-[calc(100%-0.25rem)] right-5 left-5 z-30 gap-1 rounded-2xl border border-white/10 bg-[#171620] p-4 shadow-2xl lg:hidden"
        >
            <a href="#recursos" onClick={close}>
              Recursos
            </a>
            <a href="#como-funciona" onClick={close}>
              Como funciona
            </a>
            <a href="#planos" onClick={close}>
              Planos
            </a>
            <a href="#contato" onClick={close}>
              Contato
            </a>
            <Button asChild className="mt-2">
              <Link to="/cadastro" onClick={close}>
                Criar conta
              </Link>
            </Button>
        </nav>
      </header>

      <main id="landing-main" tabIndex={-1}>
      <section className="relative mx-auto grid max-w-7xl gap-10 px-5 pt-12 pb-16 sm:gap-12 sm:pt-16 sm:pb-20 lg:grid-cols-[1.04fr_.96fr] lg:gap-14 lg:px-8 lg:pt-28 lg:pb-36">
        <div className="max-w-2xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#8f78d0]/30 bg-[#8f78d0]/10 px-3 py-1.5 text-xs font-medium tracking-wide text-[#d8ceff] sm:text-sm">
            <Sparkles className="size-3.5" /> Conteúdo em movimento, operação
            sob controle
          </div>
          <h1 className="max-w-[15ch] font-heading text-[clamp(2.3rem,4vw,3.75rem)] font-semibold leading-[1.04] tracking-[-.045em] text-white md:max-w-[20ch]">
            Gerencie <span className="text-[#b4a0ff]">várias contas TikTok.</span>{" "}
            Agende tudo em um só lugar.
          </h1>
          <p className="landing-hero-copy mt-6 max-w-xl text-base leading-7 sm:text-lg sm:leading-8">
            Organize seus vídeos e carrosséis, planeje publicações em lote e
            acompanhe cada etapa do agendamento em uma única plataforma.
          </p>
          <div className="mt-8 flex flex-col gap-3 min-[480px]:flex-row">
            <Button
              size="lg"
              className="landing-primary-cta w-full min-[480px]:w-auto"
              asChild
            >
              <Link to="/cadastro">
                Criar conta <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full border-white/15 bg-white/5 text-white hover:bg-white/10 min-[480px]:w-auto"
              asChild
            >
              <a href="#como-funciona">
                <PlayCircle className="mr-2 size-4" /> Ver como funciona
              </a>
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#c7c2d7]">
            <span className="flex items-center gap-2">
              <Check className="size-4 text-[#8f78d0]" /> Organize antes de
              publicar
            </span>
            <span className="flex items-center gap-2">
              <Check className="size-4 text-[#8f78d0]" /> Trabalhe em equipe
            </span>
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
              Organize canais, planeje lotes e acompanhe o andamento das
              publicações em uma visão feita para o trabalho do dia a dia.
            </p>
          </div>

          <div className="landing-bento-grid mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <article className="landing-bento-card landing-bento-accounts flex flex-col p-5 sm:p-6 lg:col-span-2 lg:row-span-2">
              <div className="landing-demo-label" aria-label="Prévia ilustrativa, dados demonstrativos">
                <Sparkles aria-hidden="true" className="size-3.5" />
                Prévia ilustrativa · dados demonstrativos
              </div>
              <div className="landing-mini-window mt-5">
                <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <UsersRound aria-hidden="true" className="size-4 text-[#b4a0ff]" />
                    Canais e grupos
                  </div>
                  <span className="landing-mini-tag">Workspace</span>
                </div>
                <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="space-y-2.5">
                    {[
                      ["Canal 01", "Conectado"],
                      ["Canal 02", "Conectado"],
                      ["Canal 03", "Aguardando autorização"],
                    ].map(([name, status]) => (
                      <div key={name} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/7 bg-white/[.025] px-3 py-2.5">
                        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-[#34294d] text-xs font-semibold text-[#d5c9ff]">{name.slice(-2)}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-white">{name}</span>
                        <span className="max-w-[8rem] truncate text-right text-xs text-[#aaa5b8]">{status}</span>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl border border-[#8f78d0]/20 bg-[#8f78d0]/8 p-3 sm:min-w-36">
                    <span className="flex items-center gap-2 text-xs font-medium text-[#d5c9ff]">
                      <Layers3 aria-hidden="true" className="size-4" /> Grupo
                    </span>
                    <p className="mt-2 text-sm text-white">Campanha A</p>
                    <p className="mt-1 text-xs text-[#aaa5b8]">Canais selecionados</p>
                  </div>
                </div>
              </div>
              <div className="mt-auto flex items-start gap-3 pt-5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#8f78d0]/14 text-[#b4a0ff]">
                  <UsersRound aria-hidden="true" className="size-4" />
                </span>
                <div>
                  <h3 className="font-heading text-lg font-medium text-white">
                    Todas as suas contas. Uma única operação.
                  </h3>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-[#aaa5b8]">
                    Organize seus canais TikTok e trabalhe com grupos de contas
                    em um ambiente centralizado.
                  </p>
                </div>
              </div>
            </article>

            <article className="landing-bento-card p-5 sm:p-6 lg:col-span-2">
              <div className="landing-demo-label" aria-label="Prévia ilustrativa, dados demonstrativos">
                <Sparkles aria-hidden="true" className="size-3.5" />
                Prévia ilustrativa · dados demonstrativos
              </div>
              <div className="landing-mini-window mt-5 space-y-2 p-3">
                {[
                  ["Canal 01", "Vídeo preparado", "Horário definido"],
                  ["Canal 02", "Carrossel revisado", "Aguardando confirmação"],
                  ["Canal 03", "Vídeo preparado", "Horário definido"],
                ].map(([channel, media, timing]) => (
                  <div key={channel} className="grid grid-cols-[minmax(0,.8fr)_minmax(0,1fr)] gap-2 rounded-lg border border-white/7 bg-white/[.025] px-3 py-2.5 text-xs sm:grid-cols-3">
                    <span className="truncate font-medium text-white">{channel}</span>
                    <span className="truncate text-[#c9c3d5]">{media}</span>
                    <span className="col-span-2 flex items-center gap-1.5 truncate text-[#aaa5b8] sm:col-span-1">
                      <CalendarClock aria-hidden="true" className="size-3.5 shrink-0 text-[#b4a0ff]" />
                      {timing}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#8f78d0]/14 text-[#b4a0ff]">
                  <CalendarClock aria-hidden="true" className="size-4" />
                </span>
                <div>
                  <h3 className="font-heading text-lg font-medium text-white">
                    Planeje várias publicações de uma só vez.
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[#aaa5b8]">
                    Prepare conteúdos para diferentes contas e horários, revise
                    as configurações e confirme seus agendamentos.
                  </p>
                </div>
              </div>
            </article>

            <article className="landing-bento-card p-5 sm:p-6">
              <div className="landing-demo-label" aria-label="Prévia ilustrativa, dados demonstrativos">
                <Sparkles aria-hidden="true" className="size-3.5" />
                Prévia ilustrativa · dados demonstrativos
              </div>
              <div className="landing-mini-window mt-5 grid grid-cols-2 gap-2 p-3">
                <div className="landing-media-tile">
                  <Clapperboard aria-hidden="true" className="size-5 text-[#c9baff]" />
                  <span>Vídeo</span>
                </div>
                <div className="landing-media-tile landing-media-tile-photo">
                  <ImageIcon aria-hidden="true" className="size-5 text-[#d6c6ff]" />
                  <span>Fotos</span>
                </div>
                <div className="col-span-2 rounded-lg border border-white/7 bg-white/[.025] px-3 py-2 text-xs leading-5 text-[#aaa5b8]">
                  Fotos / carrossel exigem Direct Post e permissões do TikTok.
                  Inbox neste fluxo aceita apenas vídeos.
                </div>
              </div>
              <div className="mt-5 flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#8f78d0]/14 text-[#b4a0ff]">
                  <Clapperboard aria-hidden="true" className="size-4" />
                </span>
                <div>
                  <h3 className="font-heading text-lg font-medium text-white">
                    Seu conteúdo, organizado para publicar.
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[#aaa5b8]">
                    Prepare vídeos e publicações de fotos nos fluxos compatíveis
                    com os formatos e modos suportados.
                  </p>
                </div>
              </div>
            </article>

            <article className="landing-bento-card p-5 sm:p-6">
              <div className="landing-demo-label" aria-label="Prévia ilustrativa, dados demonstrativos">
                <Sparkles aria-hidden="true" className="size-3.5" />
                Prévia ilustrativa · dados demonstrativos
              </div>
              <div className="landing-mini-window mt-5 space-y-2 p-3">
                <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-white/7 bg-white/[.025] px-3 py-2.5">
                  <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-emerald-300" />
                  <span className="truncate text-xs text-[#e4e0ed]">Publicação concluída</span>
                </div>
                <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-white/7 bg-white/[.025] px-3 py-2.5">
                  <Clock3 aria-hidden="true" className="size-4 shrink-0 text-[#c9baff]" />
                  <span className="truncate text-xs text-[#e4e0ed]">Agendamento</span>
                </div>
                <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-white/7 bg-white/[.025] px-3 py-2.5">
                  <BadgeCheck aria-hidden="true" className="size-4 shrink-0 text-amber-200" />
                  <span className="truncate text-xs text-[#e4e0ed]">Precisa de atenção</span>
                </div>
              </div>
              <div className="mt-5 flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#8f78d0]/14 text-[#b4a0ff]">
                  <CheckCircle2 aria-hidden="true" className="size-4" />
                </span>
                <div>
                  <h3 className="font-heading text-lg font-medium text-white">
                    Acompanhe cada etapa da publicação.
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[#aaa5b8]">
                    Visualize agendamentos, publicações concluídas e itens que
                    precisam de atenção.
                  </p>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section
        id="como-funciona"
        className="relative mx-auto max-w-7xl px-5 py-24 lg:px-8"
      >
        <div className="text-center">
          <p className="text-sm font-medium text-[#b4a0ff]">COMO FUNCIONA</p>
          <h2 className="mx-auto mt-3 max-w-3xl font-heading text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">
            Da organização ao acompanhamento, em um fluxo claro.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-[#aaa5b8]">
            Uma visão demonstrativa de como contas, conteúdos e agendamentos se
            conectam na operação.
          </p>
        </div>
        <ol className="landing-flow-grid mt-12 grid gap-4 md:grid-cols-3">
          {[
            {
              number: "01",
              title: "Conecte e organize contas",
              text: "Conecte seus canais TikTok e reúna os que trabalham juntos em grupos.",
              visual: (
                <div className="landing-flow-visual">
                  <span className="landing-demo-label">
                    <Sparkles aria-hidden="true" className="size-3.5" />
                    Demonstração
                  </span>
                  <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/8 bg-white/[.025] p-3">
                    <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-[#34294d] text-xs text-[#d5c9ff]">01</span>
                    <span className="flex-1 text-sm text-white">Canal TikTok</span>
                    <BadgeCheck aria-hidden="true" className="size-4 text-emerald-300" />
                  </div>
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-[#8f78d0]/20 bg-[#8f78d0]/8 p-3 text-xs text-[#d5c9ff]">
                    <UsersRound aria-hidden="true" className="size-4" /> Grupo de contas
                  </div>
                </div>
              ),
            },
            {
              number: "02",
              title: "Prepare conteúdos e horários",
              text: "Escolha a mídia, defina as contas e organize quando cada publicação deve acontecer.",
              visual: (
                <div className="landing-flow-visual">
                  <span className="landing-demo-label">
                    <Sparkles aria-hidden="true" className="size-3.5" />
                    Demonstração
                  </span>
                  <div className="mt-4 grid grid-cols-[2.5rem_1fr] items-center gap-3 rounded-xl border border-white/8 bg-white/[.025] p-3">
                    <span className="grid size-10 place-items-center rounded-lg bg-[#8f78d0]/14 text-[#c9baff]"><Clapperboard aria-hidden="true" className="size-5" /></span>
                    <span className="min-w-0"><span className="block truncate text-sm text-white">Conteúdo selecionado</span><span className="mt-1 block text-xs text-[#aaa5b8]">Conta · horário · formato</span></span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-[#c9c3d5]"><CalendarClock aria-hidden="true" className="size-4 text-[#b4a0ff]" /> Revisão antes de confirmar</div>
                </div>
              ),
            },
            {
              number: "03",
              title: "Confirme e acompanhe",
              text: "Revise o agendamento e acompanhe os estados no histórico de publicações.",
              visual: (
                <div className="landing-flow-visual">
                  <span className="landing-demo-label">
                    <Sparkles aria-hidden="true" className="size-3.5" />
                    Demonstração
                  </span>
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[.025] p-3 text-xs text-[#e4e0ed]"><CheckCircle2 aria-hidden="true" className="size-4 text-emerald-300" /> Estado atualizado</div>
                    <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[.025] p-3 text-xs text-[#e4e0ed]"><Clock3 aria-hidden="true" className="size-4 text-[#c9baff]" /> Próxima etapa visível</div>
                  </div>
                </div>
              ),
            },
          ].map(({ number, title, text, visual }) => (
            <li key={number} className="landing-flow-card rounded-2xl border border-white/8 bg-[#12121a] p-5 sm:p-6">
              {visual}
              <div className="mt-6 flex items-start gap-3">
                <span aria-hidden="true" className="font-heading text-sm font-semibold text-[#b4a0ff]">{number}</span>
                <div>
                  <h3 className="font-heading text-lg font-medium text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#aaa5b8]">{text}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-9 text-center">
          <Button variant="outline" asChild>
            <Link to="/cadastro">
              Criar meu workspace <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
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
            Crie seu workspace e veja como o AutoClip pode dar previsibilidade
            para a sua rotina de publicação.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild>
              <Link to="/cadastro">
                Criar conta <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/15 bg-transparent text-white hover:bg-white/10"
              asChild
            >
              <a href="mailto:contato@autoclip.app">Falar com a equipe</a>
            </Button>
          </div>
        </div>
      </section>
      </main>
      <footer className="relative border-t border-white/8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-[#9691a5] sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <span>
            © {new Date().getFullYear()} AutoClip. Todos os direitos reservados.
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
    </div>
  );
}

function HeroPanel() {
  return (
    <figure className="landing-preview relative mx-auto w-full max-w-xl self-center">
      <div
        className="absolute -inset-5 rounded-full bg-[#8f78d0]/10 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative overflow-hidden rounded-[1.4rem] border border-white/12 bg-[#13131c] p-3 shadow-[0_24px_80px_rgba(0,0,0,.38)] sm:p-4">
        <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#8f78d0]/25 bg-[#8f78d0]/10 px-3 py-2 text-xs font-medium text-[#e0d7ff]">
          <span className="flex items-center gap-2">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Prévia ilustrativa
          </span>
          <span className="text-[11px] font-normal text-[#c7c2d7]">
            Dados demonstrativos
          </span>
        </figcaption>
        <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#8f78d0] text-[#130f20]">
              <Clapperboard className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="m-0 truncate text-sm font-semibold text-white">
                Calendário de conteúdo
              </p>
              <p className="m-0 text-xs text-[#aaa5b8]">
                Workspace demonstrativo
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[10px] text-[#c7c2d7]">
            SEMANA
          </span>
        </div>
        <div className="grid gap-3 pt-3 sm:grid-cols-[8rem_1fr]">
          <div className="hidden content-start gap-1 sm:grid">
            <span className="rounded-md bg-[#8f78d0]/15 px-2.5 py-2 text-xs font-medium text-[#d8ceff]">
              Calendário
            </span>
            <span className="rounded-md px-2.5 py-2 text-xs text-[#aaa5b8]">
              Canais
            </span>
            <span className="rounded-md px-2.5 py-2 text-xs text-[#aaa5b8]">
              Biblioteca
            </span>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between rounded-lg border border-white/8 bg-[#1b1a25] px-3 py-2">
              <span className="text-xs font-medium text-white">
                Próximas publicações
              </span>
              <CalendarClock className="size-4 text-[#b4a0ff]" aria-hidden="true" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-white/8 bg-[#191821] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-[#c7c2d7]">
                    Canal A · Vídeo
                  </span>
                  <span
                    className="size-2 shrink-0 rounded-full bg-[#8f78d0]"
                    aria-hidden="true"
                  />
                </div>
                <p className="mb-0 mt-3 text-sm font-medium text-white">
                  Conteúdo agendado
                </p>
                <p className="mb-0 mt-1 text-xs text-[#aaa5b8]">
                  Data e horário definidos
                </p>
              </div>
              <div className="rounded-lg border border-white/8 bg-[#191821] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-[#c7c2d7]">
                    Canal B · Carrossel
                  </span>
                  <span
                    className="size-2 shrink-0 rounded-full bg-[#67cba0]"
                    aria-hidden="true"
                  />
                </div>
                <p className="mb-0 mt-3 text-sm font-medium text-white">
                  Em revisão
                </p>
                <p className="mb-0 mt-1 text-xs text-[#aaa5b8]">
                  Aguardando aprovação
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-white/10 px-3 py-2 text-xs text-[#aaa5b8]">
              <Layers3 className="size-4 text-[#b4a0ff]" aria-hidden="true" />
              Planejamento por canal e formato
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
