import * as vscode from 'vscode';
import { registerChatPanel } from './chat/panel';
import { disposeAgent } from './chat/agent';

export function activate(context: vscode.ExtensionContext): void {
    registerChatPanel(context);

    context.subscriptions.push({
        dispose() {
            disposeAgent();
        }
    });
}
