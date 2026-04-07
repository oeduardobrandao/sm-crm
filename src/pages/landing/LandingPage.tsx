import { useState } from 'react';
import { Users, CheckSquare, ExternalLink, Calendar, ChevronDown } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <Hero />
      <Testimonial />
      <Features />
      <Faq />
      <CtaFinal />
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <span className="text-xl font-bold tracking-tight">Mesaas</span>
        <nav className="hidden gap-6 text-sm text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground transition-colors">Funcionalidades</a>
          <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
        </nav>
        <a
          href="/login"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Criar conta grátis
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24 text-center">
      <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-tight tracking-tight md:text-5xl lg:text-6xl">
        Sua agência de social media com clientes organizados, entregas no prazo e relatórios em um só lugar
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
        Mesaas é o CRM feito para gestores e agências de social media. Gerencie clientes, workflows de entrega, financeiro e aprovações — sem planilha, sem caos.
      </p>
      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        <a
          href="/login"
          className="rounded-md bg-primary px-6 py-3 text-base font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Criar conta grátis
        </a>
        <a
          href="#features"
          className="text-base font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Ver como funciona →
        </a>
      </div>
    </section>
  );
}

function Testimonial() {
  return null;
}

function Features() {
  return null;
}

function Faq() {
  return null;
}

function CtaFinal() {
  return null;
}

function Footer() {
  return null;
}
