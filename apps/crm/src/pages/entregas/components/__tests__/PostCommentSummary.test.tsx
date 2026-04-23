import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentThreadWithComments, Membro } from '@/store';

import PostCommentSummary from '../PostCommentSummary';

const membros: Membro[] = [
  {
    id: 1,
    conta_id: 'conta-1',
    user_id: 'user-1',
    nome: 'Eduardo Souza',
    email: 'edu@test.com',
    papel: 'owner',
    avatar_url: null,
    created_at: '2026-01-01',
  } as Membro,
];

function makeThread(overrides?: Partial<CommentThreadWithComments>): CommentThreadWithComments {
  return {
    id: 1,
    post_id: 10,
    conta_id: 'conta-1',
    quoted_text: 'highlighted text',
    status: 'active',
    created_by: 'user-1',
    resolved_by: null,
    created_at: new Date().toISOString(),
    resolved_at: null,
    post_comments: [
      {
        id: 100,
        thread_id: 1,
        author_id: 'user-1',
        content: 'First comment',
        created_at: new Date().toISOString(),
        updated_at: null,
      },
    ],
    ...overrides,
  };
}

const defaultProps = {
  membros,
  onThreadClick: vi.fn(),
};

describe('PostCommentSummary', () => {
  beforeEach(() => {
    defaultProps.onThreadClick.mockClear();
  });

  it('returns null when there are no threads', () => {
    const { container } = render(
      <PostCommentSummary threads={[]} {...defaultProps} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the header with thread count', () => {
    const threads = [makeThread(), makeThread({ id: 2 })];
    render(<PostCommentSummary threads={threads} {...defaultProps} />);

    expect(screen.getByText('Comentários internos')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('starts expanded when there are active threads', () => {
    const threads = [makeThread({ status: 'active' })];
    render(<PostCommentSummary threads={threads} {...defaultProps} />);

    expect(screen.getByText('First comment')).toBeInTheDocument();
  });

  it('starts collapsed when all threads are resolved', () => {
    const threads = [makeThread({ status: 'resolved' })];
    render(<PostCommentSummary threads={threads} {...defaultProps} />);

    expect(screen.queryByText('First comment')).not.toBeInTheDocument();
  });

  it('toggles expansion on header click', () => {
    const threads = [makeThread({ status: 'active' })];
    render(<PostCommentSummary threads={threads} {...defaultProps} />);

    expect(screen.getByText('First comment')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Comentários internos'));
    expect(screen.queryByText('First comment')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Comentários internos'));
    expect(screen.getByText('First comment')).toBeInTheDocument();
  });

  it('shows quoted text and comment preview', () => {
    const threads = [makeThread({ quoted_text: 'selected text' })];
    render(<PostCommentSummary threads={threads} {...defaultProps} />);

    expect(screen.getByText('selected text')).toBeInTheDocument();
    expect(screen.getByText('First comment')).toBeInTheDocument();
  });

  it('shows author name resolved from membros', () => {
    const threads = [makeThread()];
    render(<PostCommentSummary threads={threads} {...defaultProps} />);

    expect(screen.getByText('Eduardo Souza')).toBeInTheDocument();
  });

  it('falls back to "Membro" for unknown author', () => {
    const threads = [makeThread({ created_by: 'unknown' })];
    render(<PostCommentSummary threads={threads} {...defaultProps} />);

    expect(screen.getByText('Membro')).toBeInTheDocument();
  });

  it('calls onThreadClick when a thread is clicked', () => {
    const threads = [makeThread({ id: 42 })];
    render(<PostCommentSummary threads={threads} {...defaultProps} />);

    fireEvent.click(screen.getByText('First comment'));
    expect(defaultProps.onThreadClick).toHaveBeenCalledWith(42);
  });

  it('shows reply count for threads with multiple comments', () => {
    const threads = [
      makeThread({
        post_comments: [
          { id: 100, thread_id: 1, author_id: 'user-1', content: 'First', created_at: new Date().toISOString(), updated_at: null },
          { id: 101, thread_id: 1, author_id: 'user-1', content: 'Reply 1', created_at: new Date().toISOString(), updated_at: null },
          { id: 102, thread_id: 1, author_id: 'user-1', content: 'Reply 2', created_at: new Date().toISOString(), updated_at: null },
        ],
      }),
    ];
    render(<PostCommentSummary threads={threads} {...defaultProps} />);

    expect(screen.getByText('2 respostas')).toBeInTheDocument();
  });

  it('shows singular reply count for one reply', () => {
    const threads = [
      makeThread({
        post_comments: [
          { id: 100, thread_id: 1, author_id: 'user-1', content: 'First', created_at: new Date().toISOString(), updated_at: null },
          { id: 101, thread_id: 1, author_id: 'user-1', content: 'Reply', created_at: new Date().toISOString(), updated_at: null },
        ],
      }),
    ];
    render(<PostCommentSummary threads={threads} {...defaultProps} />);

    expect(screen.getByText('1 resposta')).toBeInTheDocument();
  });

  it('hides resolved threads by default and shows them on toggle', () => {
    const threads = [
      makeThread({ id: 1, status: 'active', post_comments: [{ id: 100, thread_id: 1, author_id: 'user-1', content: 'Active comment', created_at: new Date().toISOString(), updated_at: null }] }),
      makeThread({ id: 2, status: 'resolved', post_comments: [{ id: 101, thread_id: 2, author_id: 'user-1', content: 'Resolved comment', created_at: new Date().toISOString(), updated_at: null }] }),
    ];
    render(<PostCommentSummary threads={threads} {...defaultProps} />);

    expect(screen.getByText('Active comment')).toBeInTheDocument();
    expect(screen.queryByText('Resolved comment')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Mostrar resolvidos'));
    expect(screen.getByText('Resolved comment')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Ocultar resolvidos'));
    expect(screen.queryByText('Resolved comment')).not.toBeInTheDocument();
  });

  it('does not show resolved toggle when there are no resolved threads', () => {
    const threads = [makeThread({ status: 'active' })];
    render(<PostCommentSummary threads={threads} {...defaultProps} />);

    expect(screen.queryByText('Mostrar resolvidos')).not.toBeInTheDocument();
  });

  it('renders active dot for active threads and resolved dot for resolved threads', () => {
    const threads = [
      makeThread({ id: 1, status: 'active' }),
      makeThread({ id: 2, status: 'resolved' }),
    ];
    render(<PostCommentSummary threads={threads} {...defaultProps} />);

    fireEvent.click(screen.getByText('Mostrar resolvidos'));

    const dots = document.querySelectorAll('.comment-summary-dot');
    expect(dots).toHaveLength(2);
    expect(dots[0].className).toContain('comment-summary-dot--active');
    expect(dots[1].className).toContain('comment-summary-dot--resolved');
  });
});
