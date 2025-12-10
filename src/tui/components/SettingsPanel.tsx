import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { getSessionStats, type AgentSession } from '../../memory';

const HIGHLIGHT = '#8CA9FF';

type SettingsTab = 'status' | 'session' | 'config' | 'collaboration';

interface SettingsPanelProps {
  onBack: () => void;
  version: string;
  currentAgent: string;
  routerAgent: string;
  plannerAgent: string;
  session: AgentSession | null;
  // Toggles
  sequential: boolean;
  pick: boolean;
  autoExecute: boolean;
  interactive: boolean;
  // Toggle setters
  onToggleSequential: () => void;
  onTogglePick: () => void;
  onToggleExecute: () => void;
  onToggleInteractive: () => void;
  // Collaboration settings
  correctFix: boolean;
  debateRounds: number;
  debateModerator: string;
  consensusRounds: number;
  consensusSynthesizer: string;
  onToggleCorrectFix: () => void;
  onSetDebateRounds: (n: number) => void;
  onSetDebateModerator: (agent: string) => void;
  onSetConsensusRounds: (n: number) => void;
  onSetConsensusSynthesizer: (agent: string) => void;
}

interface ConfigOption {
  key: string;
  label: string;
  value: boolean;
  onToggle: () => void;
}

const AGENTS = ['none', 'auto', 'claude', 'gemini', 'codex', 'ollama'];

export function SettingsPanel({
  onBack,
  version,
  currentAgent,
  routerAgent,
  plannerAgent,
  session,
  sequential,
  pick,
  autoExecute,
  interactive,
  onToggleSequential,
  onTogglePick,
  onToggleExecute,
  onToggleInteractive,
  correctFix,
  debateRounds,
  debateModerator,
  consensusRounds,
  consensusSynthesizer,
  onToggleCorrectFix,
  onSetDebateRounds,
  onSetDebateModerator,
  onSetConsensusRounds,
  onSetConsensusSynthesizer
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>('status');
  const [configIndex, setConfigIndex] = useState(0);

  // Config options organized by section
  const configSections = [
    {
      title: 'Pipeline / Workflow / Autopilot',
      options: [
        { key: 'interactive', label: 'Interactive mode', value: interactive, onToggle: onToggleInteractive }
      ]
    },
    {
      title: 'Compare',
      options: [
        { key: 'sequential', label: 'Sequential', value: sequential, onToggle: onToggleSequential },
        { key: 'pick', label: 'Pick best', value: pick, onToggle: onTogglePick }
      ]
    },
    {
      title: 'Autopilot',
      options: [
        { key: 'autoExecute', label: 'Auto-execute', value: autoExecute, onToggle: onToggleExecute }
      ]
    }
  ];

  // Flatten for navigation
  const configOptions: ConfigOption[] = configSections.flatMap(s => s.options);

  const tabs: SettingsTab[] = ['status', 'session', 'config', 'collaboration'];

  // Handle tab cycling and escape
  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.tab) {
      setTab(t => {
        const idx = tabs.indexOf(t);
        return tabs[(idx + 1) % tabs.length];
      });
    }
  });

  // Handle config navigation
  useInput((input, key) => {
    if (tab !== 'config') return;

    if (key.upArrow) {
      setConfigIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setConfigIndex(i => Math.min(configOptions.length - 1, i + 1));
    } else if (key.return || input === ' ') {
      configOptions[configIndex].onToggle();
    }
  }, { isActive: tab === 'config' });

  const [collabIndex, setCollabIndex] = useState(0);

  // Handle collaboration tab navigation
  // 0: correctFix (toggle)
  // 1: debateRounds (←/→)
  // 2: debateModerator (←/→)
  // 3: consensusRounds (←/→)
  // 4: consensusSynthesizer (←/→)
  useInput((input, key) => {
    if (tab !== 'collaboration') return;

    if (key.upArrow) {
      setCollabIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setCollabIndex(i => Math.min(4, i + 1));
    } else if (key.return || input === ' ') {
      if (collabIndex === 0) onToggleCorrectFix();
    } else if (key.leftArrow) {
      if (collabIndex === 1) onSetDebateRounds(Math.max(1, debateRounds - 1));
      else if (collabIndex === 2) {
        const idx = AGENTS.indexOf(debateModerator);
        onSetDebateModerator(AGENTS[Math.max(0, idx - 1)]);
      }
      else if (collabIndex === 3) onSetConsensusRounds(Math.max(1, consensusRounds - 1));
      else if (collabIndex === 4) {
        const idx = AGENTS.indexOf(consensusSynthesizer);
        onSetConsensusSynthesizer(AGENTS[Math.max(0, idx - 1)]);
      }
    } else if (key.rightArrow) {
      if (collabIndex === 1) onSetDebateRounds(Math.min(5, debateRounds + 1));
      else if (collabIndex === 2) {
        const idx = AGENTS.indexOf(debateModerator);
        onSetDebateModerator(AGENTS[Math.min(AGENTS.length - 1, idx + 1)]);
      }
      else if (collabIndex === 3) onSetConsensusRounds(Math.min(5, consensusRounds + 1));
      else if (collabIndex === 4) {
        const idx = AGENTS.indexOf(consensusSynthesizer);
        onSetConsensusSynthesizer(AGENTS[Math.min(AGENTS.length - 1, idx + 1)]);
      }
    }
  }, { isActive: tab === 'collaboration' });

  // Get session stats
  const sessionStats = session ? getSessionStats(session) : null;

  const getFooterHint = () => {
    switch (tab) {
      case 'config':
        return '↑/↓ navigate · Enter/Space toggle · ';
      case 'collaboration':
        return '↑/↓ navigate · Enter/Space toggle · ←/→ adjust · ';
      default:
        return '';
    }
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Tab bar */}
      <Box marginBottom={1} flexWrap="wrap">
        <Text bold>Settings: </Text>
        {tabs.map((t, i) => (
          <React.Fragment key={t}>
            <Text inverse={tab === t} color={tab === t ? HIGHLIGHT : undefined}> {t.charAt(0).toUpperCase() + t.slice(1)} </Text>
            {i < tabs.length - 1 && <Text> </Text>}
          </React.Fragment>
        ))}
        <Text dimColor>  (Tab to cycle)</Text>
      </Box>

      {/* Tab content */}
      <Box flexDirection="column" paddingLeft={1}>
        {tab === 'status' && (
          <StatusTab
            version={version}
            currentAgent={currentAgent}
            routerAgent={routerAgent}
            plannerAgent={plannerAgent}
          />
        )}
        {tab === 'session' && (
          <SessionTab session={session} stats={sessionStats} />
        )}
        {tab === 'config' && (
          <ConfigTab sections={configSections} options={configOptions} selectedIndex={configIndex} />
        )}
        {tab === 'collaboration' && (
          <CollaborationTab
            correctFix={correctFix}
            debateRounds={debateRounds}
            debateModerator={debateModerator}
            consensusRounds={consensusRounds}
            consensusSynthesizer={consensusSynthesizer}
            selectedIndex={collabIndex}
          />
        )}
      </Box>

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text dimColor>
          {getFooterHint()}Esc to exit
        </Text>
      </Box>
    </Box>
  );
}

interface StatusTabProps {
  version: string;
  currentAgent: string;
  routerAgent: string;
  plannerAgent: string;
}

function StatusTab({ version, currentAgent, routerAgent, plannerAgent }: StatusTabProps) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{'Version:'.padEnd(20)}</Text>
        <Text>{version}</Text>
      </Box>
      <Box>
        <Text bold>{'Current Agent:'.padEnd(20)}</Text>
        <Text>{currentAgent}</Text>
      </Box>
      <Box>
        <Text bold>{'Router Agent:'.padEnd(20)}</Text>
        <Text>{routerAgent}</Text>
      </Box>
      <Box>
        <Text bold>{'Planner Agent:'.padEnd(20)}</Text>
        <Text>{plannerAgent}</Text>
      </Box>
    </Box>
  );
}

interface SessionTabProps {
  session: AgentSession | null;
  stats: ReturnType<typeof getSessionStats> | null;
}

function SessionTab({ session, stats }: SessionTabProps) {
  if (!session || !stats) {
    return <Text dimColor>No active session</Text>;
  }

  const formatDate = (ts: number) => new Date(ts).toLocaleString();

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{'Session ID:'.padEnd(20)}</Text>
        <Text dimColor>{session.id}</Text>
      </Box>
      <Box>
        <Text bold>{'Agent:'.padEnd(20)}</Text>
        <Text>{session.agent}</Text>
      </Box>
      <Box>
        <Text bold>{'Messages:'.padEnd(20)}</Text>
        <Text>{stats.messageCount}</Text>
      </Box>
      <Box>
        <Text bold>{'Tokens:'.padEnd(20)}</Text>
        <Text>{stats.totalTokens} </Text>
        <Text dimColor>(recent: {stats.recentTokens}, summary: {stats.summaryTokens})</Text>
      </Box>
      <Box>
        <Text bold>{'Compression:'.padEnd(20)}</Text>
        <Text>{stats.compressionRatio}%</Text>
      </Box>
      <Box>
        <Text bold>{'Created:'.padEnd(20)}</Text>
        <Text dimColor>{formatDate(session.createdAt)}</Text>
      </Box>
      <Box>
        <Text bold>{'Updated:'.padEnd(20)}</Text>
        <Text dimColor>{formatDate(session.updatedAt)}</Text>
      </Box>
      {session.summary && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Summary:</Text>
          <Text dimColor>{session.summary.slice(0, 200)}{session.summary.length > 200 ? '...' : ''}</Text>
        </Box>
      )}
    </Box>
  );
}

interface ConfigSection {
  title: string;
  options: ConfigOption[];
}

interface ConfigTabProps {
  sections: ConfigSection[];
  options: ConfigOption[];
  selectedIndex: number;
}

function ConfigTab({ sections, options, selectedIndex }: ConfigTabProps) {
  let globalIndex = 0;
  return (
    <Box flexDirection="column">
      <Text dimColor>Configure PulzdAI preferences</Text>
      <Box flexDirection="column" marginTop={1}>
        {sections.map((section) => (
          <React.Fragment key={section.title}>
            <Text bold color="cyan">{section.title}</Text>
            {section.options.map((opt) => {
              const isSelected = globalIndex === selectedIndex;
              const currentIndex = globalIndex;
              globalIndex++;
              return (
                <Box key={opt.key}>
                  <Text color={isSelected ? HIGHLIGHT : undefined}>
                    {isSelected ? '>' : ' '} {'  ' + opt.label.padEnd(28)}
                  </Text>
                  <Text color={opt.value ? 'green' : 'gray'}>
                    {opt.value ? 'true' : 'false'}
                  </Text>
                </Box>
              );
            })}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

// --- Collaboration Tab (merged Correct, Debate, Consensus) ---

interface CollaborationTabProps {
  correctFix: boolean;
  debateRounds: number;
  debateModerator: string;
  consensusRounds: number;
  consensusSynthesizer: string;
  selectedIndex: number;
}

function CollaborationTab({
  correctFix,
  debateRounds,
  debateModerator,
  consensusRounds,
  consensusSynthesizer,
  selectedIndex
}: CollaborationTabProps) {
  return (
    <Box flexDirection="column">
      <Text dimColor>Correct, Debate, Consensus settings</Text>
      <Box flexDirection="column" marginTop={1}>
        {/* Correct */}
        <Text bold color="cyan">Correct</Text>
        <Box>
          <Text color={selectedIndex === 0 ? HIGHLIGHT : undefined}>
            {selectedIndex === 0 ? '>' : ' '} {'  Fix after review'.padEnd(28)}
          </Text>
          <Text color={correctFix ? 'green' : 'gray'}>
            {correctFix ? 'true' : 'false'}
          </Text>
        </Box>

        {/* Debate */}
        <Text bold color="cyan">Debate</Text>
        <Box>
          <Text color={selectedIndex === 1 ? HIGHLIGHT : undefined}>
            {selectedIndex === 1 ? '>' : ' '} {'  Rounds'.padEnd(28)}
          </Text>
          <Text>◀ {debateRounds} ▶</Text>
        </Box>
        <Box>
          <Text color={selectedIndex === 2 ? HIGHLIGHT : undefined}>
            {selectedIndex === 2 ? '>' : ' '} {'  Moderator'.padEnd(28)}
          </Text>
          <Text>◀ {debateModerator} ▶</Text>
        </Box>

        {/* Consensus */}
        <Text bold color="cyan">Consensus</Text>
        <Box>
          <Text color={selectedIndex === 3 ? HIGHLIGHT : undefined}>
            {selectedIndex === 3 ? '>' : ' '} {'  Voting rounds'.padEnd(28)}
          </Text>
          <Text>◀ {consensusRounds} ▶</Text>
        </Box>
        <Box>
          <Text color={selectedIndex === 4 ? HIGHLIGHT : undefined}>
            {selectedIndex === 4 ? '>' : ' '} {'  Synthesizer'.padEnd(28)}
          </Text>
          <Text>◀ {consensusSynthesizer} ▶</Text>
        </Box>
      </Box>
    </Box>
  );
}
