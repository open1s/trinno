/**
 * Prompt barrel. Importing this module registers every prompt with the
 * registry, which is what src/test/suite/prompt-contract.test.ts walks.
 */
import './system.js';
import './agents.js';
import './extractors.js';
import './writing.js';
import './slash.js';

export * from './contract.js';
export * from './registry.js';
export * from './system.js';
export * from './agents.js';
export * from './extractors.js';
export * from './writing.js';
export * from './slash.js';
