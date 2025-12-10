import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

const HIGHLIGHT_COLOR = '#8CA9FF';

interface AgentOption {
  id: string;
  name: string;
  description: string;
  ready: boolean;
}

interface AgentPanelProps {
  currentAgent: string;
  agentStatus: Array<{ name: string; ready: boolean }>;
  onSelect: (agent: string) => void;
  onBack: () => void;
}

export function AgentPanel({ currentAgent, agentStatus, onSelect, onBack }: AgentPanelProps) {
  const agents: AgentOption[] = [
    { id: 'auto', name: 'auto', description: 'Smart routing', ready: true },
    { id: 'claude', name: 'Claude Code', description: 'Anthropic', ready: agentStatus.find(a => a.name === 'claude')?.ready ?? false },
    { id: 'gemini', name: 'Gemini CLI', description: 'Google', ready: agentStatus.find(a => a.name === 'gemini')?.ready ?? false },
    { id: 'codex', name: 'Codex', description: 'OpenAI', ready: agentStatus.find(a => a.name === 'codex')?.ready ?? false },
    { id: 'ollama', name: 'Ollama', description: 'Local', ready: agentStatus.find(a => a.name === 'ollama')?.ready ?? false },
    { id: 'mistral', name: 'Mistral Vibe', description: 'Mistral', ready: agentStatus.find(a => a.name === 'mistral')?.ready ?? false },
  ];

  const currentIndex = agents.findIndex(a => a.id === currentAgent);
  const [selectedIndex, setSelectedIndex] = useState(currentIndex >= 0 ? currentIndex : 0);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
    } else if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(agents.length - 1, i + 1));
    } else if (key.return) {
      onSelect(agents[selectedIndex].id);
    }
  });

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Select Agent</Text>
        <Text> </Text>
        {agents.map((agent, idx) => {
          const isSelected = idx === selectedIndex;
          const isCurrent = agent.id === currentAgent;
          return (
            <Box key={agent.id}>
              <Text color={HIGHLIGHT_COLOR}>{isSelected ? '❯' : ' '} </Text>
              <Box width={14}>
                <Text color={isSelected ? HIGHLIGHT_COLOR : undefined} bold={isSelected}>
                  {agent.name}
                </Text>
              </Box>
              <Text dimColor>  {agent.description.padEnd(12)}</Text>
              <Text color={agent.ready ? 'green' : 'red'}>●</Text>
              <Text dimColor> {agent.ready ? 'ready' : 'offline'}</Text>
              {isCurrent && <Text color="yellow">  (current)</Text>}
            </Box>
          );
        })}
        <Text> </Text>
        <Text dimColor>↑↓ navigate · Enter select · Esc back</Text>
      </Box>
    </Box>
  );
}
