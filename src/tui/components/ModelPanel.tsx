import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { getModelSuggestions, isModelAlias } from '../../lib/models';

const HIGHLIGHT = '#8CA9FF';

type AgentTab = 'claude' | 'gemini' | 'codex' | 'ollama' | 'mistral';

interface ModelPanelProps {
  onBack: () => void;
  // Current models from config
  claudeModel: string;
  geminiModel: string;
  codexModel: string;
  ollamaModel: string;
  mistralModel: string;
  // Setters (parent handles persistence, returns warning if unknown model)
  onSetClaudeModel: (model: string) => string | undefined;
  onSetGeminiModel: (model: string) => string | undefined;
  onSetCodexModel: (model: string) => string | undefined;
  onSetOllamaModel: (model: string) => string | undefined;
  onSetMistralModel: (model: string) => string | undefined;
}

export function ModelPanel({
  onBack,
  claudeModel,
  geminiModel,
  codexModel,
  ollamaModel,
  mistralModel,
  onSetClaudeModel,
  onSetGeminiModel,
  onSetCodexModel,
  onSetOllamaModel,
  onSetMistralModel
}: ModelPanelProps) {
  const [tab, setTab] = useState<AgentTab>('claude');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [warning, setWarning] = useState<string | undefined>();

  const tabs: AgentTab[] = ['claude', 'gemini', 'codex', 'ollama', 'mistral'];

  const getCurrentModel = () => {
    switch (tab) {
      case 'claude': return claudeModel;
      case 'gemini': return geminiModel;
      case 'codex': return codexModel;
      case 'ollama': return ollamaModel;
      case 'mistral': return mistralModel;
    }
  };

  const getModels = () => {
    const suggestions = getModelSuggestions(tab);
    const current = getCurrentModel();
    // If current model isn't in suggestions, add it at the top
    if (current && !suggestions.includes(current)) {
      return [current, ...suggestions];
    }
    return suggestions.length > 0 ? suggestions : ['(no models available)'];
  };

  const setModel = (model: string) => {
    let result: string | undefined;
    switch (tab) {
      case 'claude': result = onSetClaudeModel(model); break;
      case 'gemini': result = onSetGeminiModel(model); break;
      case 'codex': result = onSetCodexModel(model); break;
      case 'ollama': result = onSetOllamaModel(model); break;
      case 'mistral': result = onSetMistralModel(model); break;
    }
    setWarning(result);
  };

  const models = getModels();
  const currentModel = getCurrentModel();

  // Handle tab cycling and escape
  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.tab) {
      setTab(t => {
        const idx = tabs.indexOf(t);
        const nextTab = tabs[(idx + 1) % tabs.length];
        setSelectedIndex(0); // Reset selection when changing tabs
        setWarning(undefined); // Clear warning
        return nextTab;
      });
    }
  });

  // Handle model selection
  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(models.length - 1, i + 1));
    } else if (key.return) {
      const selected = models[selectedIndex];
      if (selected && selected !== '(no models available)') {
        setModel(selected);
      }
    }
  });

  const getAgentLabel = (agent: AgentTab) => {
    switch (agent) {
      case 'claude': return 'Claude';
      case 'gemini': return 'Gemini';
      case 'codex': return 'Codex';
      case 'ollama': return 'Ollama';
      case 'mistral': return 'Mistral';
    }
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Tab bar */}
      <Box marginBottom={1} flexWrap="wrap">
        <Text bold>Model Selection: </Text>
        {tabs.map((t, i) => (
          <React.Fragment key={t}>
            <Text inverse={tab === t} color={tab === t ? HIGHLIGHT : undefined}>
              {' '}{getAgentLabel(t)}{' '}
            </Text>
            {i < tabs.length - 1 && <Text> </Text>}
          </React.Fragment>
        ))}
        <Text dimColor>  (Tab to cycle)</Text>
      </Box>

      {/* Current model display */}
      <Box marginBottom={1} paddingLeft={1}>
        <Text bold>Current: </Text>
        <Text color="green">{currentModel || '(default)'}</Text>
      </Box>

      {/* Model list */}
      <Box flexDirection="column" paddingLeft={1}>
        <Text dimColor>Available models for {getAgentLabel(tab)}:</Text>
        <Box flexDirection="column" marginTop={1}>
          {models.map((model, i) => {
            const isSelected = i === selectedIndex;
            const isCurrent = model === currentModel;
            const isAlias = isModelAlias(tab, model);
            const prevModel = i > 0 ? models[i - 1] : null;
            const prevWasAlias = prevModel ? isModelAlias(tab, prevModel) : true;
            const showSeparator = !isAlias && prevWasAlias && i > 0;

            return (
              <React.Fragment key={model}>
                {showSeparator && (
                  <Box marginTop={1} marginBottom={1}>
                    <Text dimColor>── Specific versions ──</Text>
                  </Box>
                )}
                <Box>
                  <Text color={isSelected ? HIGHLIGHT : undefined}>
                    {isSelected ? '>' : ' '} {model.padEnd(35)}
                  </Text>
                  {isAlias && <Text dimColor> (latest)</Text>}
                  {isCurrent && <Text color="green"> ✓</Text>}
                </Box>
              </React.Fragment>
            );
          })}
        </Box>
      </Box>

      {/* Warning display */}
      {warning && (
        <Box marginTop={1} paddingLeft={1}>
          <Text color="yellow">{warning}</Text>
        </Box>
      )}

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ to navigate · Enter to select · Esc to exit
        </Text>
      </Box>
    </Box>
  );
}
