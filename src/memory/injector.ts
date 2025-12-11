/**
 * Injector (Phase 11)
 *
 * Formats retrieved memory items for prompt injection.
 * Supports XML (Claude) and Markdown (other agents) formats.
 */

import type { MemoryItem, MemoryType } from './vector-store';
import { buildContext } from './retriever';

export type InjectionFormat = 'xml' | 'markdown';

export interface InjectionOptions {
  /** Output format (xml for Claude, markdown for others) */
  format?: InjectionFormat;
  /** Maximum tokens for injected content */
  maxTokens?: number;
  /** Include conversation history */
  includeConversation?: boolean;
  /** Include code context */
  includeCode?: boolean;
  /** Include past decisions */
  includeDecisions?: boolean;
  /** Include user patterns */
  includePatterns?: boolean;
}

export interface InjectionResult {
  content: string;
  tokens: number;
  itemCount: number;
  breakdown: Record<MemoryType, number>;
}

/**
 * Get human-readable type label
 */
function getTypeLabel(type: MemoryType): string {
  switch (type) {
    case 'conversation': return 'Past Conversation';
    case 'code': return 'Code Reference';
    case 'decision': return 'Previous Decision';
    case 'pattern': return 'User Preference';
    case 'context': return 'Project Context';
    default: return 'Memory';
  }
}

/**
 * Format items as XML (best for Claude)
 * Uses CDATA for code content to avoid escaping issues
 */
function formatAsXML(items: MemoryItem[]): string {
  if (items.length === 0) return '';

  const lines: string[] = ['<memory>'];

  for (const item of items) {
    lines.push(`  <item type="${item.type}">`);

    // Use CDATA for code content to preserve special characters
    if (item.type === 'code') {
      lines.push(`    <content><![CDATA[${item.content}]]></content>`);
    } else {
      lines.push(`    <content>${escapeXML(item.content)}</content>`);
    }

    if (item.metadata) {
      lines.push(`    <metadata>${escapeXML(JSON.stringify(item.metadata))}</metadata>`);
    }
    lines.push('  </item>');
  }

  lines.push('</memory>');
  return lines.join('\n');
}

/**
 * Format items as Markdown (good for all agents)
 */
function formatAsMarkdown(items: MemoryItem[]): string {
  if (items.length === 0) return '';

  const lines: string[] = ['## Relevant Context\n'];

  // Group by type
  const byType = new Map<MemoryType, MemoryItem[]>();
  for (const item of items) {
    const group = byType.get(item.type) || [];
    group.push(item);
    byType.set(item.type, group);
  }

  for (const [type, typeItems] of byType) {
    lines.push(`### ${getTypeLabel(type)}\n`);

    for (const item of typeItems) {
      // Wrap code in fenced blocks
      if (type === 'code') {
        lines.push('```');
        lines.push(item.content);
        lines.push('```\n');
      } else {
        lines.push(item.content);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

/**
 * Escape XML special characters
 */
function escapeXML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build and format memory context for prompt injection
 */
export async function buildInjection(
  query: string,
  options: InjectionOptions = {}
): Promise<InjectionResult> {
  const {
    format = 'markdown',
    maxTokens = 2000,
    includeConversation = true,
    includeCode = true,
    includeDecisions = true,
    includePatterns = true
  } = options;

  const context = await buildContext(query, {
    maxTokens,
    includeConversation,
    includeCode,
    includeDecisions,
    includePatterns
  });

  const content = format === 'xml'
    ? formatAsXML(context.items)
    : formatAsMarkdown(context.items);

  return {
    content,
    tokens: context.totalTokens,
    itemCount: context.items.length,
    breakdown: context.breakdown
  };
}

/**
 * Format a single memory item
 */
export function formatItem(item: MemoryItem, format: InjectionFormat = 'markdown'): string {
  if (format === 'xml') {
    return formatAsXML([item]);
  }
  return formatAsMarkdown([item]);
}

/**
 * Determine best format for an agent
 */
export function getFormatForAgent(agent: string): InjectionFormat {
  // Claude prefers XML tags
  if (agent === 'claude') {
    return 'xml';
  }
  // Others work well with markdown
  return 'markdown';
}

/**
 * Build injection with auto-detected format
 */
export async function buildInjectionForAgent(
  query: string,
  agent: string,
  options: Omit<InjectionOptions, 'format'> = {}
): Promise<InjectionResult> {
  return buildInjection(query, {
    ...options,
    format: getFormatForAgent(agent)
  });
}
