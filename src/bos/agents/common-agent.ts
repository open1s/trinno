import { buildCommonAgentContent } from '../prompts/index.js';

export const COMMON_AGENT_NAME = 'ARTEMIS';
export const COMMON_AGENT_DESCRIPTION = 'hypothesis-driven workflow (Autoresearch based TDD)';
export const isCommonAgent = (name: string): boolean => name === COMMON_AGENT_NAME;

export function getCommonAgentContent(): string {
  return buildCommonAgentContent();
}
