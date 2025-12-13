import React from 'react';
import { Box, Text } from 'ink';

export interface ToolCallInfo {
  id: string;
  name: string;
  args: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: string;
}

interface ToolActivityProps {
  calls: ToolCallInfo[];
  iteration: number;
  expanded?: boolean;
}

// Format tool display name and target
function formatToolCall(name: string, args: string): { displayName: string; target: string } {
  const parsed = tryParseArgs(args);

  switch (name) {
    case 'view':
      return { displayName: 'Read', target: parsed.path || parsed.file || args };
    case 'glob':
      return { displayName: 'Glob', target: parsed.pattern || args };
    case 'grep':
      return { displayName: 'Grep', target: parsed.pattern || args };
    case 'bash':
      return { displayName: 'Bash', target: parsed.command || args };
    case 'write':
      return { displayName: 'Write', target: parsed.path || parsed.file || args };
    case 'edit':
      return { displayName: 'Update', target: parsed.path || parsed.file || args };
    default:
      return { displayName: name, target: args };
  }
}

// Try to parse args string to extract values
function tryParseArgs(args: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Parse "key=value, key2=value2" format
  const parts = args.split(', ');
  for (const part of parts) {
    const [key, ...valueParts] = part.split('=');
    if (key && valueParts.length > 0) {
      result[key.trim()] = valueParts.join('=').trim();
    }
  }
  return result;
}

// Truncate and format result for display
function formatResult(result: string, maxLines: number = 3): { lines: string[]; truncated: boolean } {
  const allLines = result.split('\n').filter(l => l.trim());
  const truncated = allLines.length > maxLines;
  const lines = allLines.slice(0, maxLines);
  return { lines, truncated };
}

export function ToolActivity({ calls, iteration, expanded = false }: ToolActivityProps) {
  if (calls.length === 0) return null;

  // Show more calls when expanded
  const maxCalls = expanded ? 20 : 6;
  const maxLines = expanded ? 15 : 3;
  const maxLineLength = expanded ? 120 : 60;
  const recentCalls = calls.slice(-maxCalls);

  return (
    <Box flexDirection="column" marginY={1}>
      {recentCalls.map((call) => {
        const { displayName, target } = formatToolCall(call.name, call.args);
        const statusColor = call.status === 'error' ? 'red' :
                           call.status === 'done' ? 'green' :
                           call.status === 'running' ? 'yellow' : 'gray';
        const nameColor = call.status === 'error' ? 'red' : 'white';

        // Truncate target for display (longer when expanded)
        const maxTargetLen = expanded ? 100 : 50;
        const displayTarget = target.length > maxTargetLen ? target.slice(0, maxTargetLen - 3) + '...' : target;

        return (
          <Box key={call.id} flexDirection="column">
            {/* Main line: ● ToolName(target) */}
            <Box>
              <Text color={statusColor}>● </Text>
              <Text color={nameColor} bold>{displayName}</Text>
              <Text dimColor>(</Text>
              <Text>{displayTarget}</Text>
              <Text dimColor>)</Text>
            </Box>

            {/* Result lines with tree character */}
            {call.status === 'done' && call.result && (
              <Box flexDirection="column" marginLeft={2}>
                {(() => {
                  const { lines, truncated } = formatResult(call.result, maxLines);
                  return (
                    <>
                      {lines.map((line, i) => (
                        <Box key={i}>
                          <Text dimColor>{i === lines.length - 1 && !truncated ? '└ ' : '│ '}</Text>
                          <Text dimColor>{line.slice(0, maxLineLength)}{line.length > maxLineLength ? '...' : ''}</Text>
                        </Box>
                      ))}
                      {truncated && (
                        <Box>
                          <Text dimColor>└ </Text>
                          <Text dimColor>... +{call.result.split('\n').length - maxLines} lines </Text>
                          <Text color="gray">(ctrl+s to {expanded ? 'collapse' : 'expand'})</Text>
                        </Box>
                      )}
                    </>
                  );
                })()}
              </Box>
            )}

            {/* Error display */}
            {call.status === 'error' && call.result && (
              <Box marginLeft={2}>
                <Text dimColor>└ </Text>
                <Text color="red">{call.result.slice(0, maxLineLength)}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      {calls.length > maxCalls && (
        <Box marginLeft={2}>
          <Text dimColor>... and {calls.length - maxCalls} more </Text>
          <Text color="gray">(ctrl+s to {expanded ? 'collapse' : 'expand'})</Text>
        </Box>
      )}
    </Box>
  );
}
