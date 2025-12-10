import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

// Colors
const BORDER_COLOR = '#fc8657';
const AGENT_COLOR = '#06ba9e';

interface CompareResult {
  agent: string;
  content: string;
  error?: string;
  duration?: number;
  loading?: boolean;
}

interface CompareViewProps {
  results: CompareResult[];
  onExit: () => void;
  inputValue?: string;
  interactive?: boolean; // Set to false for historical views (shows "all" mode, no keyboard)
}

type ViewMode = 'side-by-side' | 'expanded' | 'all';

// Format error messages to be more user-friendly
function formatError(error: string): string {
  // Rate limit errors (429)
  if (error.includes('429') || error.includes('Resource exhausted') || error.includes('rate limit')) {
    return 'Rate limited (429) - quota exceeded, try again later or switch model';
  }
  // Authentication errors
  if (error.includes('401') || error.includes('403') || error.includes('Unauthorized') || error.includes('authentication')) {
    return 'Auth failed - run the agent CLI directly to re-authenticate';
  }
  // Network errors
  if (error.includes('ENOTFOUND') || error.includes('ECONNREFUSED') || error.includes('network')) {
    return 'Network error - check your internet connection';
  }
  // Timeout
  if (error.includes('timeout') || error.includes('ETIMEDOUT') || error.includes('Timeout')) {
    return 'Timed out after 120s - try a simpler prompt or different model';
  }
  // Model not found
  if (error.includes('model') && (error.includes('not found') || error.includes('does not exist'))) {
    return 'Model not found - check /model list for available models';
  }
  // Context length exceeded
  if (error.includes('context') && (error.includes('length') || error.includes('too long') || error.includes('exceeded'))) {
    return 'Context too long - try a shorter prompt';
  }
  // Server errors (500+)
  if (error.includes('500') || error.includes('502') || error.includes('503') || error.includes('Internal Server Error')) {
    return 'Server error (5xx) - the API is having issues, try again later';
  }
  // Keep short errors as-is, truncate long ones
  if (error.length > 150) {
    // Try to extract a meaningful message
    const match = error.match(/"message":\s*"([^"]+)"/);
    if (match) {
      return match[1].length > 120 ? match[1].slice(0, 120) + '...' : match[1];
    }
    return error.slice(0, 120) + '...';
  }
  return error;
}

// Truncate text to N lines
function truncateLines(text: string, maxLines: number): { text: string; truncated: boolean; remaining: number } {
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return { text, truncated: false, remaining: 0 };
  }
  return {
    text: lines.slice(0, maxLines).join('\n'),
    truncated: true,
    remaining: lines.length - maxLines
  };
}

export function CompareView({ results, onExit, inputValue = '', interactive = true }: CompareViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [expandedIndex, setExpandedIndex] = useState<number>(0);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);

  const anyLoading = results.some(r => r.loading);

  // Only handle keyboard input for interactive views
  useInput((char, key) => {
    // If user is typing, don't capture keys (except Escape)
    if (inputValue.trim() && !key.escape) {
      return;
    }

    // Disable navigation while loading (except Escape)
    if (anyLoading && !key.escape) {
      return;
    }

    // Arrow keys to navigate in side-by-side view
    if (viewMode === 'side-by-side') {
      if (key.leftArrow) {
        setHighlightedIndex(i => Math.max(0, i - 1));
        return;
      }
      if (key.rightArrow) {
        setHighlightedIndex(i => Math.min(results.length - 1, i + 1));
        return;
      }
      if (key.return) {
        setExpandedIndex(highlightedIndex);
        setViewMode('expanded');
        return;
      }
    }

    // Arrow keys in expanded view to switch agents
    if (viewMode === 'expanded') {
      if (key.leftArrow) {
        setExpandedIndex(i => Math.max(0, i - 1));
        return;
      }
      if (key.rightArrow) {
        setExpandedIndex(i => Math.min(results.length - 1, i + 1));
        return;
      }
    }

    // Tab to show all
    if (key.tab) {
      setViewMode('all');
      return;
    }

    // Escape to go back or exit
    if (key.escape) {
      if (viewMode === 'side-by-side') {
        onExit();
      } else {
        setViewMode('side-by-side');
      }
      return;
    }
  }, { isActive: interactive });

  // Non-interactive views always show "all" mode
  if (!interactive) {
    const termWidth = process.stdout.columns || 80;
    const lineLength = Math.floor((termWidth - 2) * 0.8);

    return (
      <Box flexDirection="column" width="100%">
        {results.map((result, i) => {
          const isError = !!result.error;
          const borderColor = isError ? 'red' : BORDER_COLOR;
          const durationText = result.duration ? (result.duration / 1000).toFixed(1) + 's' : '-';

          return (
            <Box key={i} flexDirection="column" marginBottom={i < results.length - 1 ? 1 : 0}>
              <Text color={borderColor}>
                {'─'.repeat(2)} <Text bold color={AGENT_COLOR}>{result.agent}</Text>
                {isError && <Text color="red"> [FAILED]</Text>}
              </Text>
              <Text color={borderColor}>{'─'.repeat(lineLength)}</Text>
              <Box paddingY={1}>
                <Text color={isError ? 'red' : undefined} wrap="wrap">
                  {result.content || (result.error ? formatError(result.error) : 'No response')}
                </Text>
              </Box>
              <Text color={borderColor}>
                <Text color="green">●</Text>
                <Text dimColor> {durationText}</Text>
              </Text>
              <Text color={borderColor}>{'─'.repeat(lineLength)}</Text>
            </Box>
          );
        })}
      </Box>
    );
  }

  // === MODE 1: Side-by-side ===
  if (viewMode === 'side-by-side') {
    return (
      <Box flexDirection="column" width="100%">
        <Box flexDirection="row" width="100%">
          {results.map((result, i) => {
            const { text, truncated, remaining } = truncateLines(
              result.content || (result.error ? formatError(result.error) : 'No response'),
              6
            );
            const isError = !!result.error;
            const isLoading = !!result.loading;
            // Only show highlight when all results are loaded
            const isHighlighted = !anyLoading && i === highlightedIndex;

            return (
              <Box
                key={i}
                flexDirection="column"
                borderStyle="round"
                borderColor={isError ? 'red' : isLoading ? 'yellow' : isHighlighted ? BORDER_COLOR : 'white'}
                flexGrow={1}
                flexBasis={0}
                minWidth={35}
                marginRight={i < results.length - 1 ? 1 : 0}
              >
                {/* Header */}
                <Box paddingX={1}>
                  <Text bold color={AGENT_COLOR}>{result.agent}</Text>
                  {isError && <Text color="red"> [FAILED]</Text>}
                </Box>

                {/* Content */}
                <Box paddingX={1} paddingY={1} flexDirection="column">
                  {!isLoading && (
                    <>
                      <Text color={isError ? 'red' : undefined} wrap="wrap">
                        {text}
                      </Text>
                      {truncated && (
                        <Text dimColor>[+{remaining} more lines]</Text>
                      )}
                    </>
                  )}
                </Box>

                {/* Divider + Footer */}
                <Box flexDirection="column">
                  <Text color={isHighlighted ? BORDER_COLOR : 'white'}>{'─'.repeat(30)}</Text>
                  <Box paddingX={1}>
                    <Text color={isLoading ? 'yellow' : 'green'}>●</Text>
                    {isLoading ? (
                      <Text color="yellow"> running...</Text>
                    ) : (
                      <Text dimColor> {result.duration ? (result.duration / 1000).toFixed(1) + 's' : '-'}</Text>
                    )}
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>

        {/* Help bar - only show when not loading */}
        {!anyLoading && (
          <Box marginTop={1}>
            <Text dimColor>←/→ navigate │ Enter = expand │ Tab = all │ Esc = exit</Text>
          </Box>
        )}
      </Box>
    );
  }

  // === MODE 2: Expanded single ===
  if (viewMode === 'expanded') {
    const result = results[expandedIndex];
    const isError = !!result.error;
    const isLoading = !!result.loading;
    const borderColor = isError ? 'red' : isLoading ? 'yellow' : BORDER_COLOR;

    // Calculate header width
    const termWidth = process.stdout.columns || 80;
    const statusText = isError ? ' [FAILED]' : isLoading ? ' [loading...]' : '';
    const headerPrefix = 3 + result.agent.length + ' [expanded]'.length + statusText.length + 1;
    const headerDashes = Math.max(10, termWidth - headerPrefix);

    return (
      <Box flexDirection="column">
        {/* Header divider */}
        <Text color={borderColor}>
          ── <Text bold color={AGENT_COLOR}>{result.agent}</Text>
          <Text dimColor> [expanded]</Text>
          {isError && <Text color="red"> [FAILED]</Text>}
          {isLoading && <Text color="yellow"> [loading...]</Text>}
          {' '}{'─'.repeat(headerDashes)}
        </Text>

        {/* Full content */}
        <Box paddingY={1}>
          {isLoading ? (
            <Text color="yellow">● thinking...</Text>
          ) : (
            <Text color={isError ? 'red' : undefined} wrap="wrap">
              {result.content || (result.error ? formatError(result.error) : 'No response')}
            </Text>
          )}
        </Box>

        {/* Footer */}
        <Text color={borderColor}>
          <Text color={isLoading ? 'yellow' : 'green'}>●</Text>
          <Text dimColor> {result.duration ? (result.duration / 1000).toFixed(1) + 's' : '-'}</Text>
          <Text dimColor> │ ←/→ switch │ Tab = all │ Esc = back</Text>
        </Text>
        <Text color={borderColor}>{'─'.repeat(Math.floor((termWidth - 2) * 0.8))}</Text>
      </Box>
    );
  }

  // === MODE 3: Show all (stacked) - simple dividers ===
  const termWidth = process.stdout.columns || 80;
  const lineLength = Math.floor((termWidth - 2) * 0.8); // 80% width

  return (
    <Box flexDirection="column">
      {results.map((result, i) => {
        const isError = !!result.error;
        const isLoading = !!result.loading;
        const borderColor = isError ? 'red' : isLoading ? 'yellow' : BORDER_COLOR;
        const durationText = result.duration ? (result.duration / 1000).toFixed(1) + 's' : '-';

        return (
          <Box key={i} flexDirection="column" marginBottom={i < results.length - 1 ? 1 : 0}>
            {/* Header divider */}
            <Text color={borderColor}>
              {'─'.repeat(2)} <Text bold color={AGENT_COLOR}>{result.agent}</Text>
              {isError && <Text color="red"> [FAILED]</Text>}
              {isLoading && <Text color="yellow"> [loading...]</Text>}
            </Text>
            <Text color={borderColor}>{'─'.repeat(lineLength)}</Text>

            {/* Content - unconstrained */}
            <Box paddingY={1}>
              {isLoading ? (
                <Text color="yellow">● thinking...</Text>
              ) : (
                <Text color={isError ? 'red' : undefined} wrap="wrap">
                  {result.content || (result.error ? formatError(result.error) : 'No response')}
                </Text>
              )}
            </Box>

            {/* Footer divider */}
            <Text color={borderColor}>
              <Text color={isLoading ? 'yellow' : 'green'}>●</Text>
              <Text dimColor> {durationText}</Text>
            </Text>
            <Text color={borderColor}>{'─'.repeat(lineLength)}</Text>
          </Box>
        );
      })}

      {/* Help bar */}
      <Box marginTop={1}>
        <Text dimColor>Esc = back to side-by-side</Text>
      </Box>
    </Box>
  );
}
