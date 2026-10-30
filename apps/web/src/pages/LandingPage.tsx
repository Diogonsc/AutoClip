import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Check,
  Clapperboard,
  FileVideo,
  Layers3,
  Menu,
  PlayCircle,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";

const features = [
  { icon: CalendarClock, title: "Publique no momento certo", text: "Organize vídeos, carrosséis e aprovações em um calendário claro para o seu time." },
  { icon: FileVideo, title: "Biblioteca que acompanha o ritmo", text: "Centralize mídia, legendas e versões para encontrar o conteúdo certo sem perder tempo." },
  { icon: Layers3, title: "Fluxo de revisão simples", text: "Envie links de aprovação e mantenha clientes, criadores e equipe alinhados antes de publicar." },
  { icon: ShoppingBag, title: "TikTok Shop integrado", text: "Prepare vídeos com produtos afiliados e acompanhe o caminho para conteúdo com carrinho laranja." },
  { icon: UsersRound, title: "Um espaço por operação", text: "Separe canais, membros e permissões por workspace, sem abrir mão da visibilidade." },
  { icon: ShieldCheck, title: "Feito para publicar com segurança", text: "Estados de aprovação, registros de eventos e revalidações protegem cada agendamento." },
];

const plans = [
  { name: "Essencial", description: "Para quem está organizando a primeira operação de conteúdo.", price: "Em breve", items: ["1 workspace", "Biblioteca de mídia", "Calendário de publicações", "1 canal TikTok"], featured: false },
  { name: "Pro", description: "Para criadores e times que publicam com consistência.", price: "Em breve", items: ["Tudo do Essencial", "Aprovação de cliente", "Múltiplos canais", "TikTok Shop e afiliados", "Relatórios operacionais"], featured: true },
  { name: "Scale", description: "Para operações, agências e equipes que precisam de controle.", price: "Sob consulta", items: ["Tudo do Pro", "Workspaces e membros", "Papéis e permissões", "Onboarding dedicado", "Suporte prioritário"], featured: false },
];

export default function LandingPage() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return <main className="min-h-screen overflow-x-hidden bg-[#0c0c12] text-[#f4f4fb]">
    <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(143,120,208,.23),transparent_26%),radial-gradient(circle_at_88%_14%,rgba(89,65,140,.22),transparent_28%),linear-gradient(180deg,#0c0c12_0%,#101019_100%)]" />
    <header className="relative z-20 mx-auto flex h-20 max-w-7xl items-center justify-between px-5 lg:px-8">
      <Link to="/" className="flex items-center gap-2.5 text-inherit no-underline" onClick={close}>
        <span className="grid size-10 place-items-center rounded-xl bg-[#8f78d0] text-[#130f20] shadow-[0_0_28px_rgba(143,120,208,.38)]"><Clapperboard className="size-5" /></span>
        <span className="font-heading text-lg font-semibold tracking-tight">AutoClip</span>
      </Link>
      <nav className="hidden items-center gap-7 text-sm text-[#c7c2d7] md:flex">
        <a href="#recursos">Recursos</a><a href="#como-funciona">Como funciona</a><a href="#planos">Planos</a><a href="#contato">Contato</a>
      </nav>
      <div className="hidden items-center gap-3 md:flex"><Button variant="ghost" asChild><Link to="/login">Entrar</Link></Button><Button asChild><Link to="/cadastro">Começar agora <ArrowRight className="ml-2 size-4" /></Link></Button></div>
      <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(!open)} aria-label="Abrir menu">{open ? <X /> : <Menu />}</Button>
      {open && <nav className="absolute top-16 right-5 left-5 grid gap-2 rounded-2xl border border-white/10 bg-[#171620] p-4 shadow-2xl md:hidden"><a href="#recursos" onClick={close}>Recursos</a><a href="#como-funciona" onClick={close}>Como funciona</a><a href="#planos" onClick={close}>Planos</a><a href="#contato" onClick={close}>Contato</a><Button asChild className="mt-2"><Link to="/cadastro">Começar agora</Link></Button></nav>}
    </header>

    <section className="relative mx-auto grid max-w-7xl gap-14 px-5 pt-16 pb-24 lg:grid-cols-[1.04fr_.96fr] lg:px-8 lg:pt-28 lg:pb-36">
      <div className="max-w-2xl"><div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#8f78d0]/30 bg-[#8f78d0]/10 px-3 py-1.5 text-sm text-[#d8ceff]"><Sparkles className="size-3.5" /> Conteúdo em movimento, operação sob controle</div><h1 className="font-heading text-5xl font-semibold leading-[1.03] tracking-[-.055em] text-white sm:text-6xl lg:text-7xl">Publique melhor.<br /><span className="text-[#b4a0ff]">Cresça com método.</span></h1><p className="mt-7 max-w-xl text-lg leading-8 text-[#b9b5c9]">AutoClip reúne planejamento, mídia, publicação e TikTok Shop em uma operação de conteúdo que seu time realmente consegue acompanhar.</p><div className="mt-9 flex flex-wrap gap-3"><Button size="lg" asChild><Link to="/cadastro">Experimentar a plataforma <ArrowRight className="ml-2 size-4" /></Link></Button><Button size="lg" variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10" asChild><a href="#como-funciona"><PlayCircle className="mr-2 size-4" /> Ver como funciona</a></Button></div><div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#a9a4b7]"><span className="flex items-center gap-2"><Check className="size-4 text-[#8f78d0]" /> Organize antes de publicar</span><span className="flex items-center gap-2"><Check className="size-4 text-[#8f78d0]" /> Trabalhe em equipe</span></div></div>
      <HeroPanel />
    </section>

    <section id="recursos" className="relative border-y border-white/7 bg-white/[.025]"><div className="mx-auto max-w-7xl px-5 py-24 lg:px-8"><div className="max-w-2xl"><p className="text-sm font-medium text-[#b4a0ff]">UMA OPERAÇÃO, UM LUGAR</p><h2 className="mt-3 font-heading text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">Da ideia à publicação, sem perder o fio.</h2><p className="mt-4 text-[#aaa5b8]">Cada recurso existe para reduzir o atrito entre produzir, revisar, aprovar e colocar conteúdo no ar.</p></div><div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{features.map(({ icon: Icon, title, text }) => <article key={title} className="rounded-2xl border border-white/8 bg-[#15151e]/80 p-6 transition hover:-translate-y-1 hover:border-[#8f78d0]/35"><span className="grid size-10 place-items-center rounded-xl bg-[#8f78d0]/14 text-[#b4a0ff]"><Icon className="size-5" /></span><h3 className="mt-5 font-heading text-lg font-medium text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-[#aaa5b8]">{text}</p></article>)}</div></div></section>

    <section id="como-funciona" className="relative mx-auto max-w-7xl px-5 py-24 lg:px-8"><div className="grid gap-12 lg:grid-cols-[.85fr_1.15fr]"><div><p className="text-sm font-medium text-[#b4a0ff]">COMO FUNCIONA</p><h2 className="mt-3 font-heading text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">Seu próximo post não deveria depender de planilhas e mensagens soltas.</h2><p className="mt-5 text-[#aaa5b8]">Dê contexto para cada publicação e deixe que o AutoClip cuide do caminho operacional.</p><Button className="mt-7" variant="outline" asChild><Link to="/cadastro">Criar meu workspace <ArrowRight className="ml-2 size-4" /></Link></Button></div><ol className="grid gap-4">{[["01","Centralize", "Envie mídia, organize legendas e mantenha o material disponível para quem precisa criar."],["02","Planeje", "Defina canal, data, formato e responsável com uma visão única do calendário."],["03","Revise", "Peça aprovação antes do agendamento e mantenha o histórico da decisão registrado."],["04","Publique", "Envie para TikTok, acompanhe o status e use o fluxo de Shop quando houver produto afiliado."]].map(([number,title,text]) => <li key={number} className="grid grid-cols-[3.5rem_1fr] gap-4 rounded-2xl border border-white/8 bg-[#12121a] p-5"><span className="font-heading text-lg text-[#8f78d0]">{number}</span><div><h3 className="font-medium text-white">{title}</h3><p className="mt-1 text-sm leading-6 text-[#aaa5b8]">{text}</p></div></li>)}</ol></div></section>

    <section id="planos" className="relative border-y border-white/7 bg-[#13131c]"><div className="mx-auto max-w-7xl px-5 py-24 lg:px-8"><div className="text-center"><p className="text-sm font-medium text-[#b4a0ff]">PLANOS</p><h2 className="mt-3 font-heading text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">Cresça no seu ritmo.</h2><p className="mt-4 text-[#aaa5b8]">Escolha uma base para sua operação. Os valores finais serão divulgados no lançamento comercial.</p></div><div className="mt-12 grid gap-5 lg:grid-cols-3">{plans.map((plan) => <article key={plan.name} className={`rounded-2xl border p-7 ${plan.featured ? "border-[#8f78d0] bg-[#211b34] shadow-[0_18px_50px_rgba(0,0,0,.25)]" : "border-white/8 bg-[#171620]"}`}><div className="flex items-center justify-between"><h3 className="font-heading text-xl font-semibold text-white">{plan.name}</h3>{plan.featured && <span className="rounded-full bg-[#8f78d0] px-2.5 py-1 text-xs font-medium text-[#160f2a]">Mais completo</span>}</div><p className="mt-3 min-h-12 text-sm leading-6 text-[#aaa5b8]">{plan.description}</p><p className="mt-7 font-heading text-3xl font-semibold text-white">{plan.price}</p><ul className="mt-7 grid gap-3 text-sm text-[#d0cbdc]">{plan.items.map((item) => <li key={item} className="flex gap-2"><BadgeCheck className="mt-0.5 size-4 shrink-0 text-[#b4a0ff]" />{item}</li>)}</ul><Button className="mt-8 w-full" variant={plan.featured ? "default" : "outline"} asChild><Link to="/cadastro">Quero conhecer</Link></Button></article>)}</div></div></section>

    <section id="contato" className="relative mx-auto max-w-5xl px-5 py-24 text-center lg:px-8"><div className="rounded-3xl border border-[#8f78d0]/25 bg-[linear-gradient(135deg,rgba(143,120,208,.2),rgba(31,25,48,.9))] px-6 py-14 sm:px-12"><Sparkles className="mx-auto size-6 text-[#b4a0ff]" /><h2 className="mt-5 font-heading text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">Conteúdo é criatividade. A operação pode ser simples.</h2><p className="mx-auto mt-4 max-w-2xl text-[#c0bbd0]">Crie seu workspace e veja como o AutoClip pode dar previsibilidade para a sua rotina de publicação.</p><div className="mt-8 flex flex-wrap justify-center gap-3"><Button size="lg" asChild><Link to="/cadastro">Começar agora <ArrowRight className="ml-2 size-4" /></Link></Button><Button size="lg" variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10" asChild><a href="mailto:contato@autoclip.app">Falar com a equipe</a></Button></div></div></section>
    <footer className="relative border-t border-white/8"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-[#9691a5] sm:flex-row sm:items-center sm:justify-between lg:px-8"><span>© {new Date().getFullYear()} AutoClip. Todos os direitos reservados.</span><div className="flex gap-5"><a href="/privacy-policy.html">Privacidade</a><a href="/terms-of-service.html">Termos de uso</a><Link to="/login">Entrar</Link></div></div></footer>
  </main>;
}

function HeroPanel() { return <div className="relative mx-auto w-full max-w-xl self-center"><div className="absolute -inset-8 rounded-full bg-[#8f78d0]/15 blur-3xl" /><div className="relative overflow-hidden rounded-[1.6rem] border border-white/12 bg-[#15151e] p-4 shadow-2xl"><div className="flex items-center justify-between border-b border-white/8 pb-4"><div className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[#ef647d]" /><span className="size-2.5 rounded-full bg-[#f0d2a3]" /><span className="size-2.5 rounded-full bg-[#67cba0]" /></div><span className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-[#aaa5b8]">AUTCLIP / CALENDÁRIO</span></div><div className="mt-4 grid grid-cols-[1fr_11rem] gap-4"><div className="grid gap-3"><div className="rounded-xl border border-white/8 bg-[#1d1b28] p-3"><div className="flex items-center justify-between"><span className="text-xs text-[#a9a4b7]">Publicação agendada</span><span className="rounded-full bg-[#67cba0]/15 px-2 py-0.5 text-[10px] text-[#67cba0]">Pronta</span></div><div className="mt-3 flex gap-3"><div className="grid size-10 place-items-center rounded-lg bg-[#8f78d0]/20"><Clapperboard className="size-5 text-[#b4a0ff]" /></div><div><p className="m-0 text-sm font-medium text-white">Rotina que escala</p><p className="m-0 text-xs text-[#8f78d0]">Hoje, 18:30</p></div></div></div><div className="rounded-xl border border-[#8f78d0]/25 bg-[#8f78d0]/10 p-3"><p className="m-0 text-xs text-[#d8ceff]">TikTok Shop</p><p className="mt-2 text-sm font-medium text-white">Produto afiliado vinculado</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-4/5 rounded-full bg-[#8f78d0]" /></div></div></div><div className="rounded-xl border border-white/8 bg-[#11111a] p-3"><p className="text-xs text-[#9691a5]">Esta semana</p><p className="mt-1 font-heading text-2xl font-semibold text-white">12 <span className="text-sm font-normal text-[#9691a5]">publicações</span></p><div className="mt-4 flex h-16 items-end gap-1.5">{[35,55,42,76,60,88,70].map((h,i)=><span key={i} className="w-full rounded-t bg-[#8f78d0]" style={{height:`${h}%`,opacity:.35+i*.08}} />)}</div></div></div></div></div> }
