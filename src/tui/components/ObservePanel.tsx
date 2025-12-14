import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

const HIGHLIGHT_COLOR = '#8CA9FF';

interface ObserveOption {
  id: string;
  name: string;
  description: string;
}

interface ObservePanelProps {
  onSelect: (option: string) => void;
  onBack: () => void;
}

export function ObservePanel({ onSelect, onBack }: ObservePanelProps) {
  const options: ObserveOption[] = [
    { id: 'summary', name: 'Summary', description: 'Show observation statistics' },
    { id: 'list', name: 'List', description: 'List recent observations' },
    { id: 'export', name: 'Export', description: 'Export observations to file' },
    { id: 'preferences', name: 'Preferences', description: 'Export DPO preference pairs' },
  ];

  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
    } else if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(options.length - 1, i + 1));
    } else if (key.return) {
      onSelect(options[selectedIndex].id);
    }
  });

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Training Observations</Text>
        <Text> </Text>
        {options.map((option, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <Box key={option.id}>
              <Text color={HIGHLIGHT_COLOR}>{isSelected ? '>' : ' '} </Text>
              <Box width={14}>
                <Text color={isSelected ? HIGHLIGHT_COLOR : undefined} bold={isSelected}>
                  {option.name}
                </Text>
              </Box>
              <Text dimColor>  {option.description}</Text>
            </Box>
          );
        })}
        <Text> </Text>
        <Text dimColor>Up/Down navigate - Enter select - Esc back</Text>
      </Box>
    </Box>
  );
}
