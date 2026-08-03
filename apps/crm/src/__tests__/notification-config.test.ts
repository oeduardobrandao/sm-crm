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
