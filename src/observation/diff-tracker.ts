/**
 * Diff Tracker (Phase 10)
 *
 * Tracks differences between LLM-proposed content and user-accepted content.
 * Used to understand what edits users make to AI output.
 */

import { createTwoFilesPatch, structuredPatch } from 'diff';

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileDiff {
  path: string;
  original: string;
  modified: string;
  patch: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  hasChanges: boolean;
}

/**
 * Compute diff between original (LLM proposed) and modified (user accepted) content
 */
export function computeDiff(
  path: string,
  original: string,
  modified: string
): FileDiff {
  // Generate unified diff patch
  const patch = createTwoFilesPatch(
    `a/${path}`,
    `b/${path}`,
    original,
    modified,
    '',
    '',
    { context: 3 }
  );

  // Get structured patch for hunk analysis
  const structured = structuredPatch(
    `a/${path}`,
    `b/${path}`,
    original,
    modified,
    '',
    '',
    { context: 3 }
  );

  // Count additions and deletions
  let additions = 0;
  let deletions = 0;

  const hunks: DiffHunk[] = structured.hunks.map(hunk => {
    const lines: string[] = [];
    for (const line of hunk.lines) {
      lines.push(line);
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }

    return {
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines
    };
  });

  return {
    path,
    original,
    modified,
    patch,
    hunks,
    additions,
    deletions,
    hasChanges: additions > 0 || deletions > 0
  };
}

/**
 * Compute diffs for multiple files
 */
export function computeMultiFileDiff(
  files: Array<{ path: string; original: string; modified: string }>
): FileDiff[] {
  return files.map(f => computeDiff(f.path, f.original, f.modified));
}

/**
 * Get a summary of changes for logging
 */
export function getDiffSummary(diffs: FileDiff[]): string {
  const changed = diffs.filter(d => d.hasChanges);
  if (changed.length === 0) return 'No changes';

  const totalAdditions = changed.reduce((sum, d) => sum + d.additions, 0);
  const totalDeletions = changed.reduce((sum, d) => sum + d.deletions, 0);

  return `${changed.length} file(s) modified: +${totalAdditions} -${totalDeletions}`;
}

/**
 * Extract user edits as a Record<path, diff> for storage
 */
export function extractUserEdits(
  proposed: Record<string, string>,
  final: Record<string, string>
): Record<string, string> {
  const edits: Record<string, string> = {};

  for (const path of Object.keys(final)) {
    const original = proposed[path] || '';
    const modified = final[path];

    if (original !== modified) {
      const diff = computeDiff(path, original, modified);
      if (diff.hasChanges) {
        edits[path] = diff.patch;
      }
    }
  }

  return edits;
}
