import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import StepCommit, { csvCell } from '../StepCommit';
import type { CommitRowResult } from '@/services/dataImport';

describe('csvCell — formula injection guard', () => {
  test.each([
    ["=cmd|'/c calc'!A0", "'=cmd|'/c calc'!A0"],
    ['+1+1', "'+1+1"],
    ['-1+1', "'-1+1"],
    ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
  ])('prefixes a leading %s with a single quote', (raw, expectedInner) => {
    expect(csvCell(raw)).toBe(`"${expectedInner}"`);
  });

  test('leaves an ordinary value untouched (aside from CSV quoting)', () => {
    expect(csvCell('dados.csv:3')).toBe('"dados.csv:3"');
  });

  test('still escapes embedded quotes on a neutralized formula cell', () => {
    expect(csvCell('=A1&"x"')).toBe(`"'=A1&""x"""`);
  });
});

describe('StepCommit — failure report download', () => {
  let blobParts: BlobPart[][];

  beforeEach(() => {
    blobParts = [];
    class MockBlob {
      parts: BlobPart[];
      constructor(parts: BlobPart[]) {
        this.parts = parts;
        blobParts.push(parts);
      }
    }
    vi.stubGlobal('Blob', MockBlob as unknown as typeof Blob);
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('neutralizes a formula-injecting sourceKey in the downloaded CSV', () => {
    const failed: CommitRowResult[] = [
      {
        sourceKey: "=cmd|'/c calc'!A0.csv:1",
        table: null,
        rowId: null,
        skipped: false,
        failed: true,
      },
    ];

    render(
      <StepCommit
        progress={{ done: 1, total: 1 }}
        results={failed}
        error={null}
        undoResult={null}
        undoing={false}
        onRetry={() => {}}
        onUndo={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('Baixar relatório de falhas (CSV)'));

    expect(blobParts).toHaveLength(1);
    const csv = String(blobParts[0][0]);
    expect(csv).toContain("\"'=cmd|'/c calc'!A0.csv:1\"");
    // The raw, un-neutralized formula must never appear in the output.
    expect(csv).not.toMatch(/[^'"]="cmd/);
  });
});
