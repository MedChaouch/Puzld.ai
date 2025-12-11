/**
 * Stream Parser Tests
 */

import { describe, test, expect } from 'bun:test';
import { StreamParser, parseLine, formatToolCall, type ToolCall } from './stream-parser';

describe('StreamParser', () => {
  test('parses init message', () => {
    const parser = new StreamParser();
    const line = '{"type":"system","subtype":"init","session_id":"abc123","tools":["Read","Write","Bash"]}';

    const events = parser.parseLine(line);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('init');
    if (events[0].type === 'init') {
      expect(events[0].sessionId).toBe('abc123');
      expect(events[0].tools).toEqual(['Read', 'Write', 'Bash']);
    }
  });

  test('parses single tool call', () => {
    const parser = new StreamParser();
    const line = '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_123","name":"Read","input":{"file_path":"/tmp/test.txt"}}]}}';

    const events = parser.parseLine(line);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_call');
    if (events[0].type === 'tool_call') {
      expect(events[0].call.name).toBe('Read');
      expect(events[0].call.input.file_path).toBe('/tmp/test.txt');
      expect(events[0].call.id).toBe('toolu_123');
    }
  });

  test('parses multiple tool calls in single message', () => {
    const parser = new StreamParser();
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/a.txt' } },
          { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/b.txt' } },
          { type: 'tool_use', id: 'toolu_3', name: 'Glob', input: { pattern: '*.ts' } }
        ]
      }
    });

    const events = parser.parseLine(line);

    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('tool_call');
    expect(events[1].type).toBe('tool_call');
    expect(events[2].type).toBe('tool_call');

    if (events[0].type === 'tool_call') {
      expect(events[0].call.input.file_path).toBe('/a.txt');
    }
    if (events[2].type === 'tool_call') {
      expect(events[2].call.name).toBe('Glob');
    }
  });

  test('parses tool result', () => {
    const parser = new StreamParser();

    // First add a tool call
    parser.parseLine('{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_123","name":"Read","input":{"file_path":"/test.txt"}}]}}');

    // Then the result
    const events = parser.parseLine('{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_123","content":"file contents here"}]}}');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_result');
    if (events[0].type === 'tool_result') {
      expect(events[0].result.toolUseId).toBe('toolu_123');
      expect(events[0].result.content).toBe('file contents here');
    }
  });

  test('parses multiple tool results', () => {
    const parser = new StreamParser();

    // Add tool calls
    parser.parseLine(JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/a.txt' } },
          { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/b.txt' } }
        ]
      }
    }));

    // Multiple results
    const events = parser.parseLine(JSON.stringify({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'content a' },
          { type: 'tool_result', tool_use_id: 'toolu_2', content: 'content b' }
        ]
      }
    }));

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('tool_result');
    expect(events[1].type).toBe('tool_result');
  });

  test('parses text message', () => {
    const parser = new StreamParser();
    const line = '{"type":"assistant","message":{"content":[{"type":"text","text":"Here is my response"}]}}';

    const events = parser.parseLine(line);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('text');
    if (events[0].type === 'text') {
      expect(events[0].text).toBe('Here is my response');
    }
  });

  test('parses final result', () => {
    const parser = new StreamParser();
    const line = '{"type":"result","subtype":"success","result":"Final answer","usage":{"input_tokens":100,"output_tokens":50}}';

    const events = parser.parseLine(line);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('result');
    if (events[0].type === 'result') {
      expect(events[0].result).toBe('Final answer');
      expect(events[0].isError).toBe(false);
      expect(events[0].usage?.input_tokens).toBe(100);
      expect(events[0].usage?.output_tokens).toBe(50);
    }
  });

  test('parses error result', () => {
    const parser = new StreamParser();
    const line = '{"type":"result","subtype":"error","result":"Something went wrong","is_error":true}';

    const events = parser.parseLine(line);

    expect(events).toHaveLength(1);
    if (events[0].type === 'result') {
      expect(events[0].isError).toBe(true);
      expect(events[0].subtype).toBe('error');
    }
  });

  test('parses permission denial', () => {
    const parser = new StreamParser();
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: '',
      permission_denials: [
        { tool_name: 'Write', tool_input: { file_path: '/etc/passwd' } }
      ]
    });

    const events = parser.parseLine(line);

    expect(events).toHaveLength(1);
    if (events[0].type === 'result') {
      expect(events[0].permissionDenials).toHaveLength(1);
      expect(events[0].permissionDenials?.[0].tool_name).toBe('Write');
    }
  });

  test('handles malformed JSON', () => {
    const parser = new StreamParser();
    const events = parser.parseLine('not valid json');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    if (events[0].type === 'error') {
      expect(events[0].raw).toBe('not valid json');
    }
  });

  test('handles empty lines', () => {
    const parser = new StreamParser();

    expect(parser.parseLine('')).toHaveLength(0);
    expect(parser.parseLine('   ')).toHaveLength(0);
    expect(parser.parseLine('\n')).toHaveLength(0);
  });

  test('parseAll processes multiple lines', () => {
    const parser = new StreamParser();
    const output = [
      '{"type":"system","subtype":"init","session_id":"abc","tools":["Read"]}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/test"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"data"}]}}',
      '{"type":"result","result":"done"}'
    ].join('\n');

    const events = parser.parseAll(output);

    expect(events).toHaveLength(4);
    expect(events[0].type).toBe('init');
    expect(events[1].type).toBe('tool_call');
    expect(events[2].type).toBe('tool_result');
    expect(events[3].type).toBe('result');
  });

  test('event subscription works', () => {
    const parser = new StreamParser();
    const received: string[] = [];

    parser.onEvent(event => {
      received.push(event.type);
    });

    parser.parseLine('{"type":"system","subtype":"init","session_id":"abc","tools":[]}');
    parser.parseLine('{"type":"result","result":"done"}');

    expect(received).toEqual(['init', 'result']);
  });

  test('getToolCalls returns only tool call events', () => {
    const parser = new StreamParser();
    parser.parseAll([
      '{"type":"system","subtype":"init","session_id":"abc","tools":[]}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Read","input":{}}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"thinking..."}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t2","name":"Write","input":{}}]}}',
      '{"type":"result","result":"done"}'
    ].join('\n'));

    const toolCalls = parser.getToolCalls();
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].call.name).toBe('Read');
    expect(toolCalls[1].call.name).toBe('Write');
  });

  test('getResult returns final result', () => {
    const parser = new StreamParser();
    parser.parseAll([
      '{"type":"system","subtype":"init","session_id":"abc","tools":[]}',
      '{"type":"result","result":"final answer","usage":{"input_tokens":10,"output_tokens":20}}'
    ].join('\n'));

    const result = parser.getResult();
    expect(result).not.toBeNull();
    expect(result?.result).toBe('final answer');
  });

  test('reset clears state', () => {
    const parser = new StreamParser();
    parser.parseAll('{"type":"system","subtype":"init","session_id":"abc","tools":[]}');

    expect(parser.getEvents()).toHaveLength(1);

    parser.reset();

    expect(parser.getEvents()).toHaveLength(0);
    expect(parser.getState().initialized).toBe(false);
  });
});

describe('formatToolCall', () => {
  test('formats Read call', () => {
    const call: ToolCall = {
      id: 't1',
      name: 'Read',
      input: { file_path: '/home/user/test.ts' },
      startedAt: Date.now()
    };
    expect(formatToolCall(call)).toBe('Read: /home/user/test.ts');
  });

  test('formats Write call with length', () => {
    const call: ToolCall = {
      id: 't1',
      name: 'Write',
      input: { file_path: '/test.ts', content: 'hello world' },
      startedAt: Date.now()
    };
    expect(formatToolCall(call)).toBe('Write: /test.ts (11 chars)');
  });

  test('formats Bash call with truncation', () => {
    const call: ToolCall = {
      id: 't1',
      name: 'Bash',
      input: { command: 'echo "this is a very long command that should be truncated at some point"' },
      startedAt: Date.now()
    };
    const result = formatToolCall(call);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).toContain('...');
  });

  test('formats Glob call', () => {
    const call: ToolCall = {
      id: 't1',
      name: 'Glob',
      input: { pattern: '**/*.ts', path: '/src' },
      startedAt: Date.now()
    };
    expect(formatToolCall(call)).toBe('Glob: **/*.ts in /src');
  });

  test('formats unknown tool', () => {
    const call: ToolCall = {
      id: 't1',
      name: 'CustomTool',
      input: { foo: 'bar' },
      startedAt: Date.now()
    };
    expect(formatToolCall(call)).toContain('CustomTool:');
  });
});
