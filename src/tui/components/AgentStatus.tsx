import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface AgentStatusProps {
  agentName: string;
  isLoading: boolean;
  startTime?: number;
  tokens?: number;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}

export function AgentStatus({ agentName, isLoading, startTime, tokens }: AgentStatusProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isLoading || !startTime) {
      setElapsed(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [isLoading, startTime]);

  if (!isLoading) return null;

  return (
    <Box marginTop={1}>
      <Text color="magenta">* </Text>
      <Text color="magenta" bold>{agentName}</Text>
      <Text dimColor> (</Text>
      <Text dimColor>esc to interrupt</Text>
      {elapsed > 0 && (
        <>
          <Text dimColor> · </Text>
          <Text color="yellow">{formatDuration(elapsed)}</Text>
        </>
      )}
      {tokens !== undefined && tokens > 0 && (
        <>
          <Text dimColor> · </Text>
          <Text color="cyan">↓ {formatTokens(tokens)} tokens</Text>
        </>
      )}
      <Text dimColor>)</Text>
    </Box>
  );
}
