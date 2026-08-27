export type ImportParseIssue = 'trello-not-a-board';

export class ImportParseError extends Error {
  constructor(public readonly issue: ImportParseIssue) {
    super(issue);
    this.name = 'ImportParseError';
  }
}
