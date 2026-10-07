import { describe, expect, it } from 'vitest';
import { AlarmClock, CalendarCheck, CalendarClock, CalendarPlus, CalendarX } from 'lucide-react';
import { getNotificationDisplay } from '../lib/notification-config';

describe('getNotificationDisplay', () => {
  it('renders mention notification with actor_name and excerpt', () => {
    const display = getNotificationDisplay('mention', {
      actor_name: 'João Silva',
      excerpt: 'Este é um comentário muito interessante',
      context_title: 'Post - Descrição do Produto',
    });

    expect(display.title).toBe('João Silva mencionou você');
    expect(display.body).toBe('Este é um comentário muito interessante');
    expect(display.icon).toBeDefined();
  });

  it('mention falls back to context_title when excerpt is missing', () => {
    const display = getNotificationDisplay('mention', {
      actor_name: 'Maria',
      context_title: 'Tarefa - Revisar conteúdo',
    });

    expect(display.title).toBe('Maria mencionou você');
    expect(display.body).toBe('Tarefa - Revisar conteúdo');
  });

  it('mention falls back to empty string when both excerpt and context_title are missing', () => {
    const display = getNotificationDisplay('mention', {
      actor_name: 'Pedro',
    });

    expect(display.title).toBe('Pedro mencionou você');
    expect(display.body).toBe('');
  });

  it('mention uses Alguém fallback when actor_name is missing', () => {
    const display = getNotificationDisplay('mention', {
      excerpt: 'Um comentário interessante',
    });

    expect(display.title).toBe('Alguém mencionou você');
    expect(display.body).toBe('Um comentário interessante');
  });

  it('renders post_publish_failed notification with client_name and post_title', () => {
    const display = getNotificationDisplay('post_publish_failed', {
      post_id: 1,
      workflow_id: 2,
      post_title: 'Carrossel de lançamento',
      client_name: 'Clínica Vitalis',
      publish_error_code: 'TOKEN_EXPIRED',
    });

    expect(display.title).toBe('Falha na publicação');
    expect(display.body).toBe('Clínica Vitalis · Carrossel de lançamento');
    expect(display.tone).toBe('danger');
    expect(display.icon).toBeDefined();
  });

  it('post_publish_failed falls back to post title only when client_name is missing', () => {
    const display = getNotificationDisplay('post_publish_failed', {
      post_title: 'Story de aniversário',
    });

    expect(display.body).toBe('Story de aniversário');
  });

  it('storage_autoclean_report shows files count and bytes freed', () => {
    const display = getNotificationDisplay('storage_autoclean_report', {
      files_count: 37,
      bytes_freed: 1.4 * 1024 ** 3,
    });

    expect(display.title).toBe('Limpeza de armazenamento');
    expect(display.body).toBe('37 arquivos removidos · 1,4 GB liberados');
    expect(display.tone).toBe('primary');
    expect(display.icon).toBeDefined();
  });

  it('storage_autoclean_report singularizes one file and survives missing metadata', () => {
    expect(
      getNotificationDisplay('storage_autoclean_report', {
        files_count: 1,
        bytes_freed: 500 * 1024 ** 2,
      }).body,
    ).toBe('1 arquivo removido · 500 MB liberados');
    expect(getNotificationDisplay('storage_autoclean_report', null).body).toBe(
      '0 arquivos removidos · 0 MB liberados',
    );
  });

  it('renders instagram_automation_failed notification', () => {
    const display = getNotificationDisplay('instagram_automation_failed', {});

    expect(display.title).toBe('Automação do Instagram com problema');
    expect(display.body).toBe(
      'Uma automação de comentários parou de enviar. Reconecte o Instagram do cliente para reativar.',
    );
    expect(display.tone).toBe('danger');
    expect(display.icon).toBeDefined();
  });

  it('renders instagram_automation_failed with target_never_published reason', () => {
    const display = getNotificationDisplay('instagram_automation_failed', {
      reason: 'target_never_published',
      automation_name: 'Calendário Setembro',
    });
    expect(display.title).toBe('Automação do Instagram com problema');
    expect(display.body).toContain('Calendário Setembro');
    expect(display.body).toContain('Escolha o post publicado');
    expect(display.body).not.toContain('Reconecte');
  });

  it('keeps the reconnect copy for the other reasons', () => {
    const display = getNotificationDisplay('instagram_automation_failed', {
      reason: 'token_expired',
    });
    expect(display.body).toContain('Reconecte');
  });

  it('still falls back to default for unknown types', () => {
    const display = getNotificationDisplay('future_unknown_type' as any, {});

    expect(display.title).toBe('Notificação');
    expect(display.body).toBe('');
    expect(display.icon).toBeDefined();
  });

  it('mention notification has appropriate tone and icon', () => {
    const display = getNotificationDisplay('mention', {
      actor_name: 'João',
      excerpt: 'Teste',
    });

    expect(display.tone).toBeDefined();
    expect(display.icon).toBeDefined();
  });

  describe('agenda events', () => {
    const base = {
      evento_id: 1,
      ocorrencia_id: 2,
      titulo: 'Gravação: Clínica Sorriso',
      inicio: '2026-10-05T14:00:00',
      data_local: '2026-10-05',
      dia_inteiro: false,
      ator_nome: 'Ana',
    };

    it('event_invited', () => {
      const d = getNotificationDisplay('event_invited', base);
      expect(d.icon).toBe(CalendarPlus);
      expect(d.title).toBe('Ana convidou você');
      expect(d.body).toBe('Gravação: Clínica Sorriso · seg., 5 de out., 14:00');
    });

    it('event_invited falls back without actor and shows date only for all-day', () => {
      const d = getNotificationDisplay('event_invited', {
        ...base,
        ator_nome: undefined,
        dia_inteiro: true,
      });
      expect(d.title).toBe('Novo convite');
      expect(d.body).toBe('Gravação: Clínica Sorriso · seg., 5 de out.');
    });

    it('event_updated', () => {
      const d = getNotificationDisplay('event_updated', base);
      expect(d.icon).toBe(CalendarClock);
      expect(d.title).toBe('Evento alterado: Gravação: Clínica Sorriso');
      expect(d.body).toBe('seg., 5 de out., 14:00');
    });

    it('event_cancelled and removed variant', () => {
      const c = getNotificationDisplay('event_cancelled', base);
      expect(c.icon).toBe(CalendarX);
      expect(c.title).toBe('Evento cancelado: Gravação: Clínica Sorriso');
      const r = getNotificationDisplay('event_cancelled', { ...base, motivo: 'removido' });
      expect(r.title).toBe('Você foi removido de Gravação: Clínica Sorriso');
    });

    it('event_rsvp maps resposta', () => {
      const sim = getNotificationDisplay('event_rsvp', { ...base, resposta: 'sim' });
      expect(sim.icon).toBe(CalendarCheck);
      expect(sim.title).toBe('Ana respondeu: Sim');
      expect(sim.body).toBe('Gravação: Clínica Sorriso · seg., 5 de out., 14:00');
      expect(getNotificationDisplay('event_rsvp', { ...base, resposta: 'nao' }).title).toBe(
        'Ana respondeu: Não',
      );
      expect(getNotificationDisplay('event_rsvp', { ...base, resposta: 'talvez' }).title).toBe(
        'Ana respondeu: Talvez',
      );
    });

    it('event_client_rsvp uses cliente_nome and maps resposta', () => {
      const meta = { ...base, ator_nome: undefined, cliente_nome: 'Clínica Sorriso' };
      const sim = getNotificationDisplay('event_client_rsvp', { ...meta, resposta: 'sim' });
      expect(sim.icon).toBe(CalendarCheck);
      expect(sim.tone).toBe('success');
      expect(sim.title).toBe('Clínica Sorriso confirmou Gravação: Clínica Sorriso');
      expect(sim.body).toBe('seg., 5 de out., 14:00');
      const nao = getNotificationDisplay('event_client_rsvp', { ...meta, resposta: 'nao' });
      expect(nao.tone).toBe('warning');
      expect(nao.title).toBe('Clínica Sorriso recusou Gravação: Clínica Sorriso');
    });

    it('event_client_rsvp falls back without cliente_nome and ignores ator_nome', () => {
      const d = getNotificationDisplay('event_client_rsvp', { ...base, resposta: 'sim' });
      expect(d.title).toBe('O cliente confirmou Gravação: Clínica Sorriso');
      expect(
        getNotificationDisplay('event_client_rsvp', { ...base, cliente_nome: 'X' }).title,
      ).toBe('X respondeu a Gravação: Clínica Sorriso');
    });

    it('event_reschedule_requested uses cliente_nome and shows the suggestion', () => {
      const d = getNotificationDisplay('event_reschedule_requested', {
        ...base,
        cliente_nome: 'Clínica Sorriso',
        inicio_sugerido: '2026-10-09T14:00:00',
      });
      expect(d.icon).toBe(CalendarClock);
      expect(d.title).toBe('Clínica Sorriso pediu para remarcar Gravação: Clínica Sorriso');
      expect(d.body).toBe('Sugestão: sex., 9 de out., 14:00');
      const sem = getNotificationDisplay('event_reschedule_requested', base);
      expect(sem.title).toBe('O cliente pediu para remarcar Gravação: Clínica Sorriso');
      expect(sem.body).toBe('seg., 5 de out., 14:00');
    });

    it('event_reschedule_requested shows an all-day suggestion as a date only', () => {
      const d = getNotificationDisplay('event_reschedule_requested', {
        ...base,
        dia_inteiro: true,
        data_local: '2026-10-05',
        inicio_sugerido: '2026-10-09T00:00:00',
      });
      expect(d.body).toBe('Sugestão: sex., 9 de out.');
    });

    it('event_reminder prefix by minutos', () => {
      const t = (minutos: number | undefined, dia_inteiro = false) =>
        getNotificationDisplay('event_reminder', { ...base, minutos, dia_inteiro });
      expect(t(10).icon).toBe(AlarmClock);
      expect(t(10).title).toBe('Em 10 minutos: Gravação: Clínica Sorriso');
      expect(t(0).title).toBe('Agora: Gravação: Clínica Sorriso');
      expect(t(1440, true).title).toBe('Amanhã: Gravação: Clínica Sorriso');
      expect(t(900, true).title).toBe('Amanhã: Gravação: Clínica Sorriso');
      expect(t(-540, true).title).toBe('Hoje: Gravação: Clínica Sorriso');
      expect(t(60).title).toBe('Em 1 hora: Gravação: Clínica Sorriso');
      expect(t(1).title).toBe('Em 1 minuto: Gravação: Clínica Sorriso');
      expect(t(undefined).title).toBe('Lembrete: Gravação: Clínica Sorriso');
    });
  });
});
