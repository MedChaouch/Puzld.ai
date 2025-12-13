import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PermissionRequest, PermissionDecision } from '../../agentic/tools/permissions';
import path from 'path';

interface PermissionPromptProps {
  request: PermissionRequest;
  onDecision: (decision: PermissionDecision) => void;
}

const ACTION_TITLES: Record<string, string> = {
  read: 'Read file',
  write: 'Write file',
  execute: 'Run command',
};

export function PermissionPrompt({ request, onDecision }: PermissionPromptProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Get directory name for "allow all in directory" option
  const dirName = request.path ? path.basename(path.dirname(request.path)) + '/' : '';

  const options: Array<{ label: string; decision: PermissionDecision }> = [
    { label: 'Yes', decision: 'allow' },
    { label: `Yes, allow ${request.action}ing from ${dirName} during this session`, decision: 'allow_dir' },
    { label: `Yes, allow all ${request.action}s during this session`, decision: 'allow_all' },
    { label: 'No', decision: 'deny' },
  ];

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(options.length - 1, i + 1));
    } else if (key.return) {
      onDecision(options[selectedIndex].decision);
    } else if (key.escape) {
      onDecision('cancel');
    }
  });

  const title = ACTION_TITLES[request.action] || 'Permission required';
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
