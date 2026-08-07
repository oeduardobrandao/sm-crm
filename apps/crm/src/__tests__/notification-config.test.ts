import { describe, expect, it } from 'vitest';
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
});
