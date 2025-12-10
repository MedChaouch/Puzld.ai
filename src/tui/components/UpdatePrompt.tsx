import React from 'react';
import { Box, Text, useInput } from 'ink';

interface UpdatePromptProps {
  currentVersion: string;
  latestVersion: string;
  onUpdate: () => void;
  onSkip: () => void;
}

export function UpdatePrompt({ currentVersion, latestVersion, onUpdate, onSkip }: UpdatePromptProps) {
  useInput((input, key) => {
    if (input.toLowerCase() === 'u') {
      onUpdate();
    } else if (input.toLowerCase() === 's' || key.escape) {
      onSkip();
    }
  });

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        <Text>
          <Text color="cyan">⬆</Text>
          <Text> Update available: </Text>
          <Text color="gray">{currentVersion}</Text>
          <Text> → </Text>
          <Text color="green" bold>{latestVersion}</Text>
        </Text>
        <Text> </Text>
        <Text>
          <Text color="cyan">[U]</Text>
          <Text> Update now   </Text>
          <Text color="gray">[S]</Text>
          <Text> Skip</Text>
        </Text>
      </Box>
    </Box>
  );
}
