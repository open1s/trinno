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
      lines.push('Sandbox is disabled by configuration. Enable in VS Code settings via `trinno.chat.sandbox.enabled`.');
    } else if (available === 'none') {
      lines.push('Sandbox is enabled but no sandbox tool found.');
      if (os === 'darwin') lines.push('Install Xcode Command Line Tools for sandbox-exec.');
      if (os === 'linux') lines.push('Install bubblewrap (`apt install bubblewrap` or `dnf install bubblewrap`).');
      if (os === 'win32') lines.push('Install Sysinternals PsExec (`psexec`) for basic sandbox, or use Windows Pro/Enterprise for AppContainer sandbox.');
      lines.push('Without a sandbox tool, `bash` commands can still escape the workspace.');
      lines.push('The tool wrapper (file path validation) is ALWAYS active regardless of sandbox status.');
    } else {
      lines.push(`Sandbox is active via \`${available}\`. Shell commands are restricted.`);
      if (os === 'win32' && available === 'psexec') {
        lines.push('Note: psexec strips admin privileges but does NOT fully restrict filesystem paths.');
        lines.push('The tool wrapper provides the primary file-access boundary on Windows.');
      }
    }

    emit('token', { tokenType: 'Text', text: lines.join('\n') });
    emit('done', {});
  },
};
