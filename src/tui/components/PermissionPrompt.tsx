import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PermissionRequest, PermissionDecision } from '../../agentic/tools/permissions';
import path from 'path';

interface PermissionPromptProps {
  request: PermissionRequest;
  onDecision: (decision: PermissionDecision) => void;
}

const ACTION_TITLES: Record<string, string> = {
  read: 'Read',
  write: 'Write',
  execute: 'Run command',
};

// More specific titles based on tool
const TOOL_TITLES: Record<string, string> = {
  view: 'Read file',
  glob: 'Search files',
  grep: 'Search content',
  write: 'Write file',
  edit: 'Edit file',
  bash: 'Run command',
};

export function PermissionPrompt({ request, onDecision }: PermissionPromptProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(selectedIndex);

  // Keep ref in sync with state
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  // Check if this is a glob pattern (contains * or ?) vs a file path
  const isPattern = request.path && (request.path.includes('*') || request.path.includes('?'));

  // Get directory name for "allow all in directory" option (only for file paths)
  const dirName = request.path && !isPattern ? path.basename(path.dirname(request.path)) + '/' : '';

  // Build options - skip "allow in directory" for patterns since it doesn't make sense
  const options: Array<{ label: string; decision: PermissionDecision }> = [
    { label: 'Yes', decision: 'allow' },
  ];

  if (dirName) {
    options.push({ label: `Yes, allow ${request.action}ing from ${dirName} during this session`, decision: 'allow_dir' });
  }

  options.push(
    { label: `Yes, allow all ${request.action}s during this session`, decision: 'allow_all' },
    { label: 'No', decision: 'deny' },
  );

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(options.length - 1, i + 1));
    } else if (key.return) {
      // Capture decision NOW, before setImmediate defers execution
      const idx = selectedIndexRef.current;
      const decision = options[idx]?.decision ?? 'allow';
      setImmediate(() => onDecision(decision));
    } else if (key.escape) {
      setImmediate(() => onDecision('cancel'));
    }
  });

  // Use tool-specific title if available, fall back to action-based title
  const title = TOOL_TITLES[request.tool] || ACTION_TITLES[request.action] || 'Permission required';
  const target = request.path || request.command || '';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1} marginBottom={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>{title}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text> {target}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text>Do you want to proceed?</Text>
      </Box>

      <Box flexDirection="column">
        {options.map((option, i) => (
          <Box key={i}>
            <Text bold={i === selectedIndex} color={i === selectedIndex ? '#8CA9FF' : undefined} dimColor={i !== selectedIndex}>
              {i === selectedIndex ? '>' : ' '} {i + 1}. {option.label}
            </Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Esc to cancel</Text>
      </Box>
    </Box>
  );
}
