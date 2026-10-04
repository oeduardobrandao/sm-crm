import { describe, expect, it } from 'vitest';
import {
  eventMeta,
  eventDescription,
  filterActions,
  FILTERABLE_TYPES,
  POPUP_ACTIONS,
} from '../workspace-events';
import type { WorkspaceEvent } from '../../lib/api';

function makeEvent(overrides: Partial<WorkspaceEvent> = {}): WorkspaceEvent {
  return {
    id: 1,
    created_at: '2026-08-12T12:00:00Z',
    action: 'client-create',
    resource_type: 'client',
    resource_id: '42',
    actor_name: 'Maria',
    actor_email: 'maria@test.com',
    metadata: null,
    ...overrides,
  };
}

describe('eventMeta', () => {
  it('returns known label for client-create', () => {
    expect(eventMeta('client-create').label).toBe('Cliente criado');
  });

  it('returns known label for post-postado', () => {
    expect(eventMeta('post-postado').label).toBe('Post publicado');
  });

  it('returns known label for instagram-link', () => {
    expect(eventMeta('instagram-link').label).toBe('Instagram conectado');
  });

  it('returns known label for accept-invite', () => {
    expect(eventMeta('accept-invite').label).toBe('Convite aceito');
  });

  it('returns known label for post-agendado', () => {
    expect(eventMeta('post-agendado').label).toBe('Post agendado');
  });

  it('labels every popup interaction with a dedicated icon', () => {
    expect(eventMeta('popup-seen').label).toBe('Popup visualizado');
    expect(eventMeta('popup-closed').label).toBe('Popup fechado');
    expect(eventMeta('popup-cta').label).toBe('Popup: clique no botão');
    expect(eventMeta('popup-ack').label).toBe('Popup confirmado');
    for (const a of POPUP_ACTIONS) {
      expect(eventMeta(a).icon).not.toBe('Activity');
    }
  });

  it('falls back to cleaned action string for unknown actions', () => {
    const meta = eventMeta('some-unknown_action.test');
    expect(meta.label).toBe('some unknown action test');
    expect(meta.icon).toBe('Activity');
  });

  it('maps each action to a non-empty icon name', () => {
    const actions = [
      'client-create',
      'accept-invite',
      'admin-create-invite',
      'instagram-link',
      'post-postado',
      'post-agendado',
      'update-role',
      'remove-user',
    ];
    for (const a of actions) {
      expect(eventMeta(a).icon).toBeTruthy();
    }
  });
});

describe('eventDescription', () => {
  it('returns client name for client-create', () => {
    const desc = eventDescription(
      makeEvent({ action: 'client-create', metadata: { nome: 'Acme Corp', sigla: 'AC' } }),
    );
    expect(desc).toBe('Acme Corp');
  });

  it('returns actor_name for post-postado', () => {
    const desc = eventDescription(
      makeEvent({
        action: 'post-postado',
        metadata: { actor_name: 'Ana', source: 'workspace_user' },
      }),
    );
    expect(desc).toBe('por Ana');
  });

  it('returns the popup title for popup interactions', () => {
    for (const action of POPUP_ACTIONS) {
      const desc = eventDescription(
        makeEvent({
          action,
          resource_type: 'popup',
          metadata: { popup_id: 'p1', title: 'Novidades de outubro' },
        }),
      );
      expect(desc).toBe('Novidades de outubro');
    }
  });

  it('returns empty string for a popup interaction without a title', () => {
    expect(eventDescription(makeEvent({ action: 'popup-cta', metadata: { popup_id: 'p1' } }))).toBe(
      '',
    );
  });

  it('returns empty string when metadata is null', () => {
    expect(eventDescription(makeEvent({ metadata: null }))).toBe('');
  });

  it('returns empty string for unknown actions with metadata', () => {
    expect(eventDescription(makeEvent({ action: 'unknown', metadata: { foo: 'bar' } }))).toBe('');
  });
});

describe('FILTERABLE_TYPES', () => {
  it('contains the main event types', () => {
    const values = FILTERABLE_TYPES.map((t) => t.value);
    expect(values).toContain('client-create');
    expect(values).toContain('instagram-link');
    expect(values).toContain('post-postado');
    expect(values).toContain('accept-invite');
  });

  it('has unique values', () => {
    const values = FILTERABLE_TYPES.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('filterActions', () => {
  it('expands the popups group into every popup action', () => {
    expect(filterActions('popups')).toEqual(POPUP_ACTIONS);
  });

  it('passes a single action through', () => {
    expect(filterActions('client-create')).toEqual(['client-create']);
  });

  it('is offered in the filter', () => {
    expect(FILTERABLE_TYPES.map((t) => t.value)).toContain('popups');
  });
});
