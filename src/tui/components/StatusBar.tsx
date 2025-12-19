import React, { memo } from 'react';
import { Box, Text } from 'ink';

export type McpStatus = 'connected' | 'disconnected' | 'local' | 'checking';

interface StatusBarProps {
  agent: string;
  messageCount?: number;
  tokens?: number;
  mcpStatus?: McpStatus;
}

export const StatusBar = memo(function StatusBar({ agent, messageCount = 0, tokens = 0, mcpStatus = 'local' }: StatusBarProps) {
  // Format tokens with K suffix for thousands
  const formatTokens = (t: number): string => {
    if (t >= 1000) {
      return (t / 1000).toFixed(1) + 'k';
    }
    return t.toString();
  };

  // MCP status display
  const getMcpDisplay = () => {
    switch (mcpStatus) {
      case 'connected':
        return <><Text color="green">MCP: </Text><Text color="green">connected</Text></>;
      case 'disconnected':
        return <><Text color="red">MCP: </Text><Text color="red">disconnected</Text></>;
      case 'checking':
        return <><Text color="yellow">MCP: </Text><Text color="yellow">...</Text></>;
      case 'local':
      default:
        return <><Text dimColor>MCP: </Text><Text dimColor>local</Text></>;
    }
  };

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1} justifyContent="space-between">
      <Box>
        <Text dimColor>agent: </Text>
        <Text color="yellow">{agent}</Text>
      </Box>
      <Box>
        <Text dimColor>messages: </Text>
        <Text>{messageCount}</Text>
      </Box>
      <Box>
        <Text dimColor>tokens: </Text>
        <Text>{formatTokens(tokens)}</Text>
      </Box>
      <Box>
        {getMcpDisplay()}
      </Box>
      <Box>
        <Text dimColor>/help</Text>
      </Box>
    </Box>
  );
});
