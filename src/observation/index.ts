/**
 * Observation Layer (Phase 10)
 *
 * Logs all interactions for training data generation.
 * Captures: prompts, responses, review decisions, user edits.
 */

export {
  startObservation,
  logResponse,
  logReviewDecision,
  completeObservation,
  getObservation,
  getRecentObservations,
  getObservationStats,
  type ObservationInput,
  type ObservationOutput,
  type ReviewDecision,
  type Observation
} from './logger';

export {
  computeDiff,
  computeMultiFileDiff,
  getDiffSummary,
  extractUserEdits,
  type FileDiff,
  type DiffHunk
} from './diff-tracker';

export {
  extractPreferencePairs,
  getPreferenceStats,
  type PreferencePair
} from './preference-extractor';

export {
  exportObservations,
  exportPreferencePairs,
  getExportSummary,
  type ExportOptions
} from './exporter';
