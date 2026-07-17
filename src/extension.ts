import * as vscode from 'vscode';
import { registerChatPanel } from './chat/panel';
import { disposeAgent } from './chat/agent';
import { ensureConfigTemplate } from './chat/settings';
import { initTracing } from '@open1s/jsbos';

const CONFIG_TOML = require('os').homedir() + '/.bos/conf/config.toml';

export function activate(context: vscode.ExtensionContext): void {
  initTracing();
  registerChatPanel(context);

  context.subscriptions.push(vscode.commands.registerCommand('trinno-chat.openConfig', () => {
    ensureConfigTemplate(CONFIG_TOML);
    vscode.workspace.openTextDocument(CONFIG_TOML).then(doc => {
      vscode.window.showTextDocument(doc, { preview: false });
    });
  }));

  context.subscriptions.push({
    dispose() {
      disposeAgent();
    }
  });
}
