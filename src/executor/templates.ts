/**
 * Pipeline template management
 *
 * Load, save, and manage reusable pipeline templates
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, cpSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { PipelineTemplate, PipelineStep } from './types';

const TEMPLATES_DIR = join(homedir(), '.puzldai', 'templates');
const OLD_TEMPLATES_DIR = join(homedir(), '.pulzdai', 'templates');

/**
 * Ensure templates directory exists and migrate old templates
 */
export function ensureTemplatesDir(): void {
  // Migrate old templates if they exist
  if (!existsSync(TEMPLATES_DIR) && existsSync(OLD_TEMPLATES_DIR)) {
    mkdirSync(TEMPLATES_DIR, { recursive: true });
    const oldTemplates = readdirSync(OLD_TEMPLATES_DIR).filter(f => f.endsWith('.json'));
    for (const file of oldTemplates) {
      const oldPath = join(OLD_TEMPLATES_DIR, file);
      const newPath = join(TEMPLATES_DIR, file);
      const content = readFileSync(oldPath, 'utf-8');
      writeFileSync(newPath, content);
    }
    if (oldTemplates.length > 0) {
      console.log(`Migrated ${oldTemplates.length} templates from ~/.pulzdai to ~/.puzldai`);
    }
  }

  if (!existsSync(TEMPLATES_DIR)) {
    mkdirSync(TEMPLATES_DIR, { recursive: true });
  }
}

/**
 * Get path to a template file
 */
function getTemplatePath(name: string): string {
  return join(TEMPLATES_DIR, `${name}.json`);
}

/**
 * Load a template by name
 */
export function loadTemplate(name: string): PipelineTemplate | null {
  const path = getTemplatePath(name);

  if (!existsSync(path)) {
    const builtin = getBuiltinTemplate(name);
    if (builtin) return builtin;
    return null;
  }

  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as PipelineTemplate;
  } catch {
    return null;
  }
}

/**
 * Save a template
 */
export function saveTemplate(template: PipelineTemplate): void {
  ensureTemplatesDir();
  const path = getTemplatePath(template.name);
  writeFileSync(path, JSON.stringify(template, null, 2));
}

/**
 * List all available templates
 */
export function listTemplates(): string[] {
  ensureTemplatesDir();

  const userTemplates = readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));

  const builtinNames = Object.keys(BUILTIN_TEMPLATES);

  return [...new Set([...builtinNames, ...userTemplates])].sort();
}

/**
 * Delete a template
 */
export function deleteTemplate(name: string): boolean {
  const path = getTemplatePath(name);
  if (!existsSync(path)) return false;

  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Built-in templates
 */
const BUILTIN_TEMPLATES: Record<string, PipelineTemplate> = {
  'code-review': {
    name: 'code-review',
    description: 'Analyze code, then review with a second opinion',
    steps: [
      { agent: 'gemini', action: 'analyze' },
      { agent: 'claude', action: 'review' }
    ],
    createdAt: 0,
    updatedAt: 0
  },

  'write-and-test': {
    name: 'write-and-test',
    description: 'Write code, then generate tests',
    steps: [
      { agent: 'claude', action: 'code' },
      { agent: 'gemini', action: 'test' }
    ],
    createdAt: 0,
    updatedAt: 0
  },

  'research-summarize': {
    name: 'research-summarize',
    description: 'Research a topic, then summarize findings',
    steps: [
      { agent: 'gemini', action: 'analyze' },
      { agent: 'ollama', action: 'summarize' }
    ],
    createdAt: 0,
    updatedAt: 0
  },

  'fix-and-verify': {
    name: 'fix-and-verify',
    description: 'Fix an issue, then verify the fix',
    steps: [
      { agent: 'claude', action: 'fix' },
      { agent: 'gemini', action: 'review' }
    ],
    createdAt: 0,
    updatedAt: 0
  },

  'triple-check': {
    name: 'triple-check',
    description: 'Get three different perspectives on a problem',
    steps: [
      { agent: 'claude', action: 'analyze' },
      { agent: 'gemini', action: 'review' },
      { agent: 'ollama', action: 'summarize' }
    ],
    createdAt: 0,
    updatedAt: 0
  }
};

function getBuiltinTemplate(name: string): PipelineTemplate | null {
  return BUILTIN_TEMPLATES[name] || null;
}

/**
 * Create a template from pipeline steps
 */
export function createTemplate(
  name: string,
  steps: PipelineStep[],
  description?: string
): PipelineTemplate {
  const now = Date.now();
  return {
    name,
    description,
    steps,
    createdAt: now,
    updatedAt: now
  };
}
