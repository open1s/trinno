import * as vscode from 'vscode';
import { registerChatPanel } from './chat/panel';
import { disposeAgent } from './chat/agent';
import { initTracing } from '@open1s/jsbos';

export function activate(context: vscode.ExtensionContext): void {
    initTracing();
    registerChatPanel(context);

    context.subscriptions.push({
        dispose() {
            disposeAgent();
        }
    });
}
