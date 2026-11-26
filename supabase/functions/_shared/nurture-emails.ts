/**
 * Nurture sequence for workspace owners who never subscribed (4 emails per
 * track). Pure builders: no I/O. Every user value goes through an escaping
 * block (paragraph, heading, strong, button label); subjects with user data go
 * through sanitizeSubjectValue.
 */
import { mesaasEmail } from "./email/shell.ts";
import {
  button,
  callout,
  featureGrid,
  heading,
  link,
  paragraph,
  paragraphHtml,
  screenshot,
  sectionTitle,
  signature,
  spacer,
  steps,
} from "./email/blocks.ts";
import { EMAIL, NURTURE_SHOTS } from "./email/tokens.ts";
import { escapeHtml } from "./report-template/escape.ts";
import { sanitizeSubjectValue } from "./lifecycle-emails.ts";
import { nurtureText } from "./i18n/catalogs/nurture.ts";
import type { Lang } from "./i18n/lang.ts";

export type NurtureStep = "a1" | "a2" | "a3" | "a4" | "b1" | "b2" | "b3" | "b4";

export const NURTURE_STEPS: readonly NurtureStep[] = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"];

export interface NurtureEmailInput {
  step: NurtureStep;
  firstName: string | null;
  workspaceName: string;
  /** ISO date or timestamp; only the YYYY-MM-DD prefix is compared. */
  workspaceCreatedAt: string;
  clientCount: number;
  firstClientName: string | null;
  hasInstagram: boolean;
  appBaseUrl: string;
  unsubUrl: string;
  whatsappUrl: string | null;
  /** Owner of a workspace whose 14-day reverse trial ended on Free: a3 becomes "Recupere o Pro". */
  exReverseTrial?: boolean;
  /** Workspace language of the owner; the copy, subject and html lang follow it. */
  lang: Lang;
}

/** Day the 30-day trial launched; accounts created before it had no free trial. */
export const TRIAL_FIRST_LAUNCH = "2026-10-27";

export const NURTURE_SAMPLE: Omit<NurtureEmailInput, "step" | "appBaseUrl" | "unsubUrl" | "whatsappUrl" | "lang"> = {
  firstName: "Ana",
  workspaceName: "Agência Aurora",
  workspaceCreatedAt: "2026-09-01",
  clientCount: 2,
  firstClientName: "Studio Bela",
  hasInstagram: false,
};

export function nurtureUtm(appBaseUrl: string, path: string, step: NurtureStep): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${appBaseUrl.replace(/\/+$/, "")}${path}${sep}utm_source=email&utm_medium=nurture&utm_campaign=nurture_${step}`;
}

/**
 * Steps that pitch the 30-day card trial. For an ex-reverse-trial workspace
 * (its trial is used up) each becomes a "Recupere o Pro" variant: no free
 * trial, no 30 days, immediate charge, link to /comecar?recomendado=pro.
 */
export const NURTURE_EX_TRIAL_STEPS: readonly NurtureStep[] = ["a3", "b1", "b2", "b3"];

export function isExTrialVariant(step: NurtureStep, exReverseTrial: boolean | null | undefined): boolean {
  return exReverseTrial === true && NURTURE_EX_TRIAL_STEPS.includes(step);
}

/** Resend `type` tag of a nurture email: `nurture_<step>`, or `nurture_<step>_ex_trial` for the variant. */
export function nurtureTagType(step: NurtureStep, exReverseTrial: boolean | null | undefined): string {
  return isExTrialVariant(step, exReverseTrial) ? `nurture_${step}_ex_trial` : `nurture_${step}`;
}

const RECOVER_PATH = "/comecar?recomendado=pro";

/** Signup names every workspace "Meu Workspace"; never put that (or a blank name) in copy. */
const DEFAULT_WORKSPACE_NAMES: Record<Lang, readonly string[]> = {
  pt: ["meu workspace"],
  en: ["my workspace", "meu workspace"],
};

/** The workspace name for copy, or null when it is blank or still the signup default. */
export function nurtureWorkspaceName(name: string | null | undefined, lang: Lang = "pt"): string | null {
  const t = (name ?? "").trim();
  if (!t || DEFAULT_WORKSPACE_NAMES[lang].includes(t.toLowerCase())) return null;
  return t;
}

/** Subject of the a3 variant for ex-reverse-trial workspaces (pt). Shared with the e-mail classifier. */
export const NURTURE_A3_EX_TRIAL_SUBJECT = nurtureText("pt").subject.a3Ex;
/** Subject of the b1 variant for ex-reverse-trial workspaces (pt; distinct from a3 for the classifier). */
export const NURTURE_B1_EX_TRIAL_SUBJECT = nurtureText("pt").subject.b1Ex;

/** Subject line of a nurture step (sanitized). Shared with the e-mail classifier. */
export function nurtureSubject(
  step: NurtureStep,
  p: { clientCount: number; exReverseTrial?: boolean },
  lang: Lang = "pt",
): string {
  const s = nurtureText(lang).subject;
  let subject: string;
  switch (step) {
    case "a1":
      subject = s.a1;
      break;
    case "a2":
      subject = s.a2;
      break;
    case "a3":
      // The reverse trial counts as the trial: an ex-trial owner cannot start
      // another one, so a3 offers the Pro back instead of a 30-day test.
      subject = p.exReverseTrial ? s.a3Ex : s.a3;
      break;
    case "b1": {
      if (p.exReverseTrial) {
        subject = s.b1Ex;
        break;
      }
      const n = Number.isFinite(p.clientCount) ? Math.max(0, Math.floor(p.clientCount)) : 0;
      subject = n === 0 ? s.b1Zero : s.b1N(n);
      break;
    }
    case "b2":
      subject = s.b2;
      break;
    case "b3":
      subject = s.b3;
      break;
    case "a4":
    case "b4":
      subject = s.a4b4;
      break;
  }
  return sanitizeSubjectValue(subject);
}

export function buildNurtureEmail(p: NurtureEmailInput): { subject: string; html: string } {
  const lang = p.lang;
  const T = nurtureText(lang);
  const c = T.common;
  const u = (path: string) => nurtureUtm(p.appBaseUrl, path, p.step);
  const greet = paragraph(p.firstName ? c.greetNamed(p.firstName) : c.greetAnon);
  const waBtn = p.whatsappUrl ? button(p.whatsappUrl, c.waButton, "outline") + spacer(24) : "";
  const shot = (key: keyof typeof NURTURE_SHOTS) => screenshot(NURTURE_SHOTS[key], c.shotAlt[key]);
  const trialGrid = () => featureGrid(c.trialGrid);
  // No plan numbers beyond Free's 2 clients: Pro limits are edited in the Admin.
  const proGrid = () => featureGrid(c.proGrid);
  // The reverse trial is used up, so subscribing charges at once.
  const recoverFine = () => paragraph(c.recoverFine, "small", "14px 0 0");
  const trialFine = () => paragraph(c.trialFine, "small", "14px 0 0");

  let preheader = "";
  let eyebrow = "";
  let sections: string[] = [];

  switch (p.step) {
    case "a1": {
      const t = T.a1;
      preheader = t.preheader;
      eyebrow = t.eyebrow;
      sections = [
        greet + paragraph(t.p1) + paragraph(t.p2) + shot("clientes"),
        sectionTitle(t.title) +
        steps([
          `${t.stepManualHtml}${spacer(12)}${button(u("/clientes"), t.btnManual)}`,
          `${t.stepImportHtml}${spacer(12)}${button(u("/importar"), t.btnImport, "outline")}`,
        ]),
        paragraphHtml(t.closingHtml, "body", "0 0 18px") + signature(lang),
      ];
      break;
    }
    case "a2": {
      const t = T.a2;
      preheader = t.preheader;
      eyebrow = c.eyebrowTip;
      sections = [
        greet + paragraph(t.p1) + paragraph(t.p2) + shot("aprovacoes"),
        callout(t.callout),
        paragraph(t.p3, "body", "0 0 18px") + button(u("/clientes"), t.btn) + spacer(24) + signature(lang),
      ];
      break;
    }
    case "a3": {
      const t = T.a3;
      if (p.exReverseTrial) {
        preheader = t.recoverPreheader;
        eyebrow = c.eyebrowRecover;
        sections = [
          heading(p.firstName ? t.recoverHeadingNamed(p.firstName) : t.recoverHeadingAnon) +
          paragraph(t.recoverP1) +
          paragraph(t.recoverP2) +
          shot("hub") +
          proGrid() + spacer(8) + button(u(RECOVER_PATH), c.recoverButton) + recoverFine(),
          paragraphHtml(t.recoverClosingHtml, "body", "0 0 18px") + signature(lang),
        ];
        break;
      }
      const trialFirst = p.workspaceCreatedAt.slice(0, 10) >= TRIAL_FIRST_LAUNCH;
      preheader = t.preheader;
      eyebrow = c.eyebrowTrial;
      sections = [
        heading(p.firstName ? t.headingNamed(p.firstName) : t.headingAnon) +
        paragraph(trialFirst ? t.leadNew : t.leadOld) +
        shot("hub") +
        trialGrid() + spacer(8) + button(u("/comecar"), c.trialButton) + trialFine(),
        paragraphHtml(t.closingHtml, "body", "0 0 18px") + signature(lang),
      ];
      break;
    }
    case "a4": {
      const t = T.a4;
      preheader = c.lastQuestionPreheader;
      eyebrow = c.eyebrowLastQuestion;
      sections = [
        greet + paragraph(t.p1) + paragraph(t.p2) + paragraph(t.p3, "body", "0 0 18px") + waBtn + signature(lang),
      ];
      break;
    }
    case "b1": {
      const t = T.b1;
      const n = Number.isFinite(p.clientCount) ? Math.max(0, Math.floor(p.clientCount)) : 0;
      const atLimit = n >= 2;
      const exTrial = p.exReverseTrial === true;
      preheader = exTrial
        ? (atLimit ? t.exPreheaderLimit : t.exPreheader)
        : (atLimit ? t.preheaderLimit : t.preheader);
      eyebrow = exTrial ? c.eyebrowRecover : c.eyebrowTrial;
      // No article before user-supplied names: "a Meu Workspace", "o Ana" read wrong.
      const ws = nurtureWorkspaceName(p.workspaceName, lang);
      const b1Heading = ws
        ? (p.firstName ? t.headingWsNamed(p.firstName, ws) : t.headingWs(ws))
        : (p.firstName ? t.headingNoWsNamed(p.firstName) : t.headingNoWs);
      if (exTrial) {
        sections = [
          heading(b1Heading) +
          paragraph(atLimit ? t.exLimit(n) : t.exFirst) +
          shot("hub") +
          proGrid() + spacer(8) + button(u(RECOVER_PATH), c.recoverButton) + recoverFine(),
          paragraphHtml(c.questionsHtml, "body", "0 0 18px") + signature(lang),
        ];
        break;
      }
      sections = [
        heading(b1Heading) +
        paragraph(atLimit ? t.limit(n) : t.first) +
        shot("hub") +
        trialGrid() + spacer(8) + button(u("/comecar"), c.trialButton) + trialFine(),
        paragraphHtml(c.questionsHtml, "body", "0 0 18px") + signature(lang),
      ];
      break;
    }
    case "b2": {
      const t = T.b2;
      const who = p.firstClientName?.trim() || null;
      preheader = who ? t.preheaderWho(who) : t.preheader;
      eyebrow = c.eyebrowTip;
      sections = [
        greet + paragraph(who ? t.p1Who(who) : t.p1) + paragraph(t.p2) + shot("aprovar"),
        ...(p.exReverseTrial
          ? [
            callout(t.calloutRecover),
            button(u(RECOVER_PATH), c.recoverButton) + recoverFine() + spacer(18) + signature(lang),
          ]
          : [
            callout(t.calloutTrial),
            button(u("/comecar"), t.btnTrial) + spacer(24) + signature(lang),
          ]),
      ];
      break;
    }
    case "b3": {
      const t = T.b3;
      preheader = t.preheader;
      eyebrow = c.eyebrowTip;
      sections = [
        greet +
        paragraph(t.p1) +
        paragraph(p.hasInstagram ? (p.exReverseTrial ? t.p2IgRecover : t.p2IgTrial) : t.p2NoIg) +
        shot("relatorios"),
        (p.exReverseTrial
          ? button(u(RECOVER_PATH), c.recoverButton) + recoverFine()
          : button(u("/comecar"), c.trialButton) + trialFine()) + spacer(18) + signature(lang),
      ];
      break;
    }
    case "b4": {
      const t = T.b4;
      preheader = c.lastQuestionPreheader;
      eyebrow = c.eyebrowLastQuestion;
      sections = [
        greet + paragraph(t.p1) + paragraph(t.p2) + paragraph(t.p3, "body", "0 0 18px") + waBtn + signature(lang),
      ];
      break;
    }
  }

  const html = mesaasEmail({
    lang,
    preheader,
    eyebrow,
    sections,
    footerLines: [],
    footerHtml: [`${escapeHtml(c.footerSentence)} ${link(p.unsubUrl, c.unsubscribe, EMAIL.muted)}.`],
  });
  return { subject: nurtureSubject(p.step, p, lang), html };
}
