import * as vscode from 'vscode';
import { registerChatPanel } from './chat/panel';
import { disposeAgent } from './chat/agent';
import { initTracing } from '@open1s/jsbos';

const CONFIG_TOML = require('os').homedir() + '/.bos/conf/config.toml';

export function activate(context: vscode.ExtensionContext): void {
    initTracing();
    registerChatPanel(context);

    context.subscriptions.push(vscode.commands.registerCommand('trinno-chat.openConfig', () => {
        const fs = require('fs');
        const path = require('path');
        const tomlPath = CONFIG_TOML;
        if (!fs.existsSync(tomlPath)) {
            vscode.window.showWarningMessage(`Config file not found: ${tomlPath}`);
            return;
        }
        vscode.workspace.openTextDocument(tomlPath).then(doc => {
            vscode.window.showTextDocument(doc, { preview: false });
        });
    }));

    context.subscriptions.push({
        dispose() {
            disposeAgent();
        }
    });
}
