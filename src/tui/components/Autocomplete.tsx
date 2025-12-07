import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';

interface Command {
  label: string;
  value: string;
  description: string;
}

const COMMANDS: Command[] = [
  // Commands
  { label: '/compare', value: '/compare ', description: 'Compare agents side-by-side' },
  { label: '/autopilot', value: '/autopilot ', description: 'AI-generated execution plan' },
  { label: '/workflow', value: '/workflow ', description: 'Run a saved workflow' },
  // Options - Values
  { label: '/agent', value: '/agent ', description: 'Show/set agent' },
  { label: '/router', value: '/router ', description: 'Show/set routing agent' },
  { label: '/planner', value: '/planner ', description: 'Show/set autopilot planner agent' },
  // Options - Toggles
  { label: '/sequential', value: '/sequential', description: 'Toggle: compare one-at-a-time' },
  { label: '/pick', value: '/pick', description: 'Toggle: select best from compare' },
  { label: '/execute', value: '/execute', description: 'Toggle: auto-run autopilot plans' },
  { label: '/interactive', value: '/interactive', description: 'Toggle: pause between steps' },
  // Nested
  { label: '/workflows', value: '/workflows', description: 'Manage workflows (interactive)' },
  // Sessions
  { label: '/session', value: '/session ', description: 'Session management' },
  { label: '/sessions', value: '/sessions', description: 'List all sessions' },
  // Utility
  { label: '/help', value: '/help', description: 'Show available commands' },
  { label: '/clear', value: '/clear', description: 'Clear chat history' },
  { label: '/exit', value: '/exit', description: 'Exit the application' },
];

interface AutocompleteProps {
  filter: string;
  onSelect: (value: string) => void;
  onCancel: () => void;
}

export function Autocomplete({ filter, onSelect, onCancel }: AutocompleteProps) {
  // Filter commands based on input
  const filtered = COMMANDS.filter(cmd =>
    cmd.value.toLowerCase().startsWith(filter.toLowerCase())
  );

  if (filtered.length === 0) {
    return null;
  }

  const items = filtered.map(cmd => ({
    label: cmd.label,
    value: cmd.value,
  }));

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
        {filtered.map((cmd, index) => (
          <Box key={cmd.value}>
            <Text color="cyan">{cmd.label}</Text>
            <Text dimColor> - {cmd.description}</Text>
          </Box>
        ))}
      </Box>
      <Text dimColor>↑↓ navigate • Enter select • Esc cancel</Text>
    </Box>
  );
}

export function getCommandSuggestions(input: string): Command[] {
  if (!input.startsWith('/')) return [];
  return COMMANDS.filter(cmd =>
    cmd.value.toLowerCase().startsWith(input.toLowerCase())
  );
}
