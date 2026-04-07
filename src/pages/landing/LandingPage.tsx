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
  return null; // implemented in next task
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
