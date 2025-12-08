import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

// Colors
const BORDER_COLOR = '#fc8657';
const AGENT_COLOR = '#06ba9e';

export interface CollaborationStep {
  agent: string;
  role: string;  // 'producer', 'reviewer', 'fix', 'round-0', 'round-1', 'moderator', 'proposal', 'vote', 'synthesis'
  content: string;
  error?: string;
  duration?: number;
  loading?: boolean;
  round?: number;  // For debate rounds
}

export type CollaborationType = 'correct' | 'debate' | 'consensus';

interface CollaborationViewProps {
  type: CollaborationType;
  steps: CollaborationStep[];
  onExit: () => void;
  inputValue?: string;
  interactive?: boolean;
}

type ViewMode = 'side-by-side' | 'expanded' | 'all';

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

// Get title for collaboration type
function getTitle(type: CollaborationType): { title: string; mode: string } {
  switch (type) {
    case 'correct': return { title: 'Cross-Agent Correction', mode: 'Correct Mode' };
    case 'debate': return { title: 'Multi-Agent Debate', mode: 'Debate Mode' };
    case 'consensus': return { title: 'Consensus Building', mode: 'Consensus Mode' };
  }
}

// Get role display name
function getRoleDisplay(step: CollaborationStep): string {
  if (step.role.startsWith('round-')) {
    const roundNum = step.round ?? parseInt(step.role.split('-')[1]);
    return `Round ${roundNum + 1}`;
  }
  switch (step.role) {
    case 'producer': return 'Producer';
    case 'reviewer': return 'Reviewer';
    case 'fix': return 'Fixed';
    case 'moderator': return 'Moderator';
    case 'proposal': return 'Proposal';
    case 'vote': return step.round !== undefined ? `Vote (Round ${step.round + 1})` : 'Vote';
    case 'synthesis': return 'Synthesis';
    default: return step.role;
  }
}

export function CollaborationView({ type, steps, onExit, inputValue = '', interactive = true }: CollaborationViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [expandedIndex, setExpandedIndex] = useState<number>(0);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);

  const anyLoading = steps.some(s => s.loading);

  useInput((char, key) => {
    if (!interactive) return;

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
      // Items per row: debate = 2, consensus = 3, correct = all
      const itemsPerRow = type === 'debate' ? 2 : type === 'consensus' ? 3 : steps.length;

      if (key.leftArrow) {
        setHighlightedIndex(i => Math.max(0, i - 1));
        return;
      }
      if (key.rightArrow) {
        setHighlightedIndex(i => Math.min(steps.length - 1, i + 1));
        return;
      }
      if (key.upArrow) {
        setHighlightedIndex(i => Math.max(0, i - itemsPerRow));
        return;
      }
      if (key.downArrow) {
        setHighlightedIndex(i => Math.min(steps.length - 1, i + itemsPerRow));
        return;
      }
      if (key.return) {
        setExpandedIndex(highlightedIndex);
        setViewMode('expanded');
        return;
      }
    }

    // Arrow keys in expanded view to switch steps
    if (viewMode === 'expanded') {
      if (key.leftArrow) {
        setExpandedIndex(i => Math.max(0, i - 1));
        return;
      }
      if (key.rightArrow) {
        setExpandedIndex(i => Math.min(steps.length - 1, i + 1));
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
  });

  // Non-interactive views always show "all" mode
  if (!interactive) {
    const termWidth = process.stdout.columns || 80;
    const lineLength = Math.floor((termWidth - 2) * 0.8);

    return (
      <Box flexDirection="column" width="100%">
        <Text bold color={BORDER_COLOR}>─── {getTitle(type).title} <Text color="yellow">[{getTitle(type).mode}]</Text> ───</Text>
        <Box height={1} />
        {steps.map((step, i) => {
          const isError = !!step.error;
          const borderColor = isError ? 'red' : BORDER_COLOR;
          const durationText = step.duration ? (step.duration / 1000).toFixed(1) + 's' : '-';

          return (
            <Box key={i} flexDirection="column" marginBottom={i < steps.length - 1 ? 1 : 0}>
              <Text color={borderColor}>
                {'─'.repeat(2)} <Text bold color={AGENT_COLOR}>{step.agent}</Text>
                <Text color={AGENT_COLOR}> [{getRoleDisplay(step)}]</Text>
                {isError && <Text color="red"> [FAILED]</Text>}
              </Text>
              <Text color={borderColor}>{'─'.repeat(lineLength)}</Text>
              <Box paddingY={1}>
                <Text color={isError ? 'red' : undefined} wrap="wrap">
                  {step.content || step.error || 'No response'}
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
    // Boxes per row: debate = 2, consensus = 3, correct = all
    const maxPerRow = type === 'debate' ? 2 : type === 'consensus' ? 3 : steps.length;
    const rows: CollaborationStep[][] = [];
    for (let i = 0; i < steps.length; i += maxPerRow) {
      rows.push(steps.slice(i, i + maxPerRow));
    }

    const renderStepBox = (step: CollaborationStep, i: number, rowLength: number, globalIndex: number) => {
      const { text, truncated, remaining } = truncateLines(
        step.content || step.error || 'No response',
        6
      );
      const isError = !!step.error;
      const isLoading = !!step.loading;
      const isHighlighted = !anyLoading && globalIndex === highlightedIndex;

      return (
        <Box
          key={globalIndex}
          flexDirection="column"
          borderStyle="round"
          borderColor={isError ? 'red' : isLoading ? 'yellow' : isHighlighted ? BORDER_COLOR : 'white'}
          flexGrow={1}
          flexBasis={0}
          minWidth={30}
          marginRight={i < rowLength - 1 ? 1 : 0}
        >
          {/* Header */}
          <Box paddingX={1} flexDirection="column">
            <Text bold color={AGENT_COLOR}>{step.agent}</Text>
            <Text color={AGENT_COLOR}>{getRoleDisplay(step)}</Text>
            {isError && <Text color="red">[FAILED]</Text>}
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
            <Text color={isHighlighted ? BORDER_COLOR : 'white'}>{'─'.repeat(25)}</Text>
            <Box paddingX={1}>
              <Text color={isLoading ? 'yellow' : 'green'}>●</Text>
              {isLoading ? (
                <Text color="yellow"> running...</Text>
              ) : (
                <Text dimColor> {step.duration ? (step.duration / 1000).toFixed(1) + 's' : '-'}</Text>
              )}
            </Box>
          </Box>
        </Box>
      );
    };

    return (
      <Box flexDirection="column" width="100%">
        <Text bold color={BORDER_COLOR}>─── {getTitle(type).title} <Text color="yellow">[{getTitle(type).mode}]</Text> ───</Text>
        <Box height={1} />
        {rows.map((row, rowIndex) => {
          const startIndex = rowIndex * maxPerRow;
          return (
            <Box key={rowIndex} flexDirection="row" width="100%" marginBottom={rowIndex < rows.length - 1 ? 1 : 0}>
              {row.map((step, i) => renderStepBox(step, i, row.length, startIndex + i))}
            </Box>
          );
        })}

        {/* Help bar */}
        {!anyLoading && (
          <Box marginTop={1}>
            <Text dimColor>{type === 'correct' ? '←/→ navigate' : '←/→/↑/↓ navigate'} │ Enter = expand │ Tab = all │ Esc = exit</Text>
          </Box>
        )}
      </Box>
    );
  }

  // === MODE 2: Expanded single ===
  if (viewMode === 'expanded') {
    const step = steps[expandedIndex];
    const isError = !!step.error;
    const isLoading = !!step.loading;
    const borderColor = isError ? 'red' : isLoading ? 'yellow' : BORDER_COLOR;

    const termWidth = process.stdout.columns || 80;
    const statusText = isError ? ' [FAILED]' : isLoading ? ' [loading...]' : '';
    const headerPrefix = 3 + step.agent.length + ` [${getRoleDisplay(step)}]`.length + ' [expanded]'.length + statusText.length + 1;
    const headerDashes = Math.max(10, termWidth - headerPrefix);

    return (
      <Box flexDirection="column">
        <Text bold color={BORDER_COLOR}>─── {getTitle(type).title} <Text color="yellow">[{getTitle(type).mode}]</Text> ───</Text>
        <Box height={1} />
        {/* Header divider */}
        <Text color={borderColor}>
          ── <Text bold color={AGENT_COLOR}>{step.agent}</Text>
          <Text color={AGENT_COLOR}> [{getRoleDisplay(step)}]</Text>
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
              {step.content || step.error || 'No response'}
            </Text>
          )}
        </Box>

        {/* Footer */}
        <Text color={borderColor}>
          <Text color={isLoading ? 'yellow' : 'green'}>●</Text>
          <Text dimColor> {step.duration ? (step.duration / 1000).toFixed(1) + 's' : '-'}</Text>
          <Text dimColor> │ {expandedIndex + 1}/{steps.length} │ ←/→ switch │ Tab = all │ Esc = back</Text>
        </Text>
        <Text color={borderColor}>{'─'.repeat(Math.floor((termWidth - 2) * 0.8))}</Text>
      </Box>
    );
  }

  // === MODE 3: Show all (stacked) ===
  const termWidth = process.stdout.columns || 80;
  const lineLength = Math.floor((termWidth - 2) * 0.8);

  return (
    <Box flexDirection="column">
      <Text bold color={BORDER_COLOR}>─── {getTitle(type).title} <Text color="yellow">[{getTitle(type).mode}]</Text> ───</Text>
      <Box height={1} />
      {steps.map((step, i) => {
        const isError = !!step.error;
        const isLoading = !!step.loading;
        const borderColor = isError ? 'red' : isLoading ? 'yellow' : BORDER_COLOR;
        const durationText = step.duration ? (step.duration / 1000).toFixed(1) + 's' : '-';

        return (
          <Box key={i} flexDirection="column" marginBottom={i < steps.length - 1 ? 1 : 0}>
            {/* Header divider */}
            <Text color={borderColor}>
              {'─'.repeat(2)} <Text bold color={AGENT_COLOR}>{step.agent}</Text>
              <Text color={AGENT_COLOR}> [{getRoleDisplay(step)}]</Text>
              {isError && <Text color="red"> [FAILED]</Text>}
              {isLoading && <Text color="yellow"> [loading...]</Text>}
            </Text>
            <Text color={borderColor}>{'─'.repeat(lineLength)}</Text>

            {/* Content */}
            <Box paddingY={1}>
              {isLoading ? (
                <Text color="yellow">● thinking...</Text>
              ) : (
                <Text color={isError ? 'red' : undefined} wrap="wrap">
                  {step.content || step.error || 'No response'}
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
