import { SlashCommand } from './registry.js';

export const sandboxCommand: SlashCommand = {
  name: 'sandbox',
  description: 'Show sandbox configuration and status',
  usage: '/sandbox',
  execute: async (_args, _deps, emit) => {
    const cfg = (globalThis as any).__SANDBOX_CONFIG || {};
    const enabled = cfg.enabled !== false;
    const available = cfg.available || 'unknown';
    const os = cfg.os || process.platform;

    const lines = [
      '## Sandbox Status',
      '',
      `| Setting | Value |`,
      `|---------|-------|`,
      `| **Enabled** | ${enabled} |`,
      `| **Available** | ${available} |`,
      `| **Active** | ${enabled && available !== 'none'} |`,
      `| **OS** | ${os} |`,
      '',
    ];

    if (!enabled) {
      lines.push('Sandbox is disabled by configuration. Set `trinno.chat.sandbox.enabled: true` in VS Code settings to enable.');
    } else if (available === 'none') {
      lines.push('Sandbox is enabled but no sandbox tool found.');
      if (os === 'darwin') lines.push('Install Xcode Command Line Tools for sandbox-exec, or disable with `sandboxEnabled: false`.');
      if (os === 'linux') lines.push('Install bubblewrap (`apt install bubblewrap` or `dnf install bubblewrap`), or disable with `sandboxEnabled: false`.');
    } else {
      lines.push(`Sandbox is active via \`${available}\`. Shell commands are restricted to the workspace directory.`);
    }

    emit('token', { tokenType: 'Text', text: lines.join('\n') });
    emit('done', {});
  },
};
