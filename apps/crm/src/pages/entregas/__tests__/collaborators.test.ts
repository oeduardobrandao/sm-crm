import { describe, expect, it } from 'vitest';
import {
  COLLAB_ERROR_COPY,
  MAX_COLLABORATORS,
  parseCollaboratorInput,
  validateCollaborator,
} from '../collaborators';

describe('parseCollaboratorInput', () => {
  it('splits a mixed paste of handles and a profile URL', () => {
    expect(
      parseCollaboratorInput(
        '@Dra.Julia, @clinicaviva\nhttps://www.instagram.com/nutri.ana/?hl=pt',
      ),
    ).toEqual(['dra.julia', 'clinicaviva', 'nutri.ana']);
  });

  it('keeps a post/reel URL whole so it fails validation instead of becoming @p or @reel', () => {
    for (const url of [
      'https://www.instagram.com/p/DAbc123/',
      'instagram.com/reel/XYZ',
      'https://instagram.com/explore/tags/verao',
    ]) {
      const [parsed] = parseCollaboratorInput(url);
      expect(parsed).not.toMatch(/^(p|reel|explore)$/);
      expect(validateCollaborator(parsed, [])).toBe('invalid');
    }
  });

  it('extracts the username from a bare profile URL', () => {
    expect(parseCollaboratorInput('instagram.com/clinicaviva')).toEqual(['clinicaviva']);
    expect(parseCollaboratorInput('http://instagram.com/clinicaviva/')).toEqual(['clinicaviva']);
    expect(parseCollaboratorInput('https://instagram.com/Clinica.Viva?igsh=abc')).toEqual([
      'clinica.viva',
    ]);
  });

  it('strips only one leading @', () => {
    expect(parseCollaboratorInput('@@x')).toEqual(['@x']);
  });

  it('drops empties', () => {
    expect(parseCollaboratorInput('  ,, \n ')).toEqual([]);
    expect(parseCollaboratorInput('@')).toEqual([]);
    expect(parseCollaboratorInput('')).toEqual([]);
  });
});

describe('validateCollaborator', () => {
  it('accepts a valid username', () => {
    expect(validateCollaborator('dra.julia_1', [])).toBeNull();
  });

  it('rejects characters outside a-z 0-9 . _', () => {
    expect(validateCollaborator('dra julia', [])).toBe('invalid');
    expect(validateCollaborator('@x', [])).toBe('invalid');
    expect(validateCollaborator('Abc', [])).toBe('invalid');
    expect(validateCollaborator('a-b', [])).toBe('invalid');
    expect(validateCollaborator('', [])).toBe('invalid');
  });

  it('allows 30 characters and rejects 31', () => {
    expect(validateCollaborator('a'.repeat(30), [])).toBeNull();
    expect(validateCollaborator('a'.repeat(31), [])).toBe('invalid');
  });

  it('flags duplicates', () => {
    expect(validateCollaborator('x', ['y', 'x'])).toBe('duplicate');
  });

  it('flags the limit at 3 entries', () => {
    expect(MAX_COLLABORATORS).toBe(3);
    expect(validateCollaborator('d', ['a', 'b'])).toBeNull();
    expect(validateCollaborator('d', ['a', 'b', 'c'])).toBe('limit');
  });

  it('checks invalid before duplicate before limit', () => {
    expect(validateCollaborator('A B', ['a', 'b', 'c'])).toBe('invalid');
    expect(validateCollaborator('a', ['a', 'b', 'c'])).toBe('duplicate');
  });
});

describe('COLLAB_ERROR_COPY', () => {
  it('uses the spec copy', () => {
    expect(COLLAB_ERROR_COPY.invalid('x')).toBe(
      'Use só letras, números, ponto e sublinhado, sem espaços.',
    );
    expect(COLLAB_ERROR_COPY.duplicate('x')).toBe('@x já está na lista.');
  });
});
