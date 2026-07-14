import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigLoader } from '@open1s/jsbos';

const TOML_PATH = path.join(os.homedir(), '.bos', 'conf', 'config.toml');

export function getChatConfig() {
  try {
    const loader = new ConfigLoader();
    loader.discover();
    return JSON.parse(loader.loadSync());
  } catch {
    return {};
  }
}

export function openConfig(): void {
  const tomlPath = TOML_PATH;
  if (!fs.existsSync(tomlPath)) {
    fs.mkdirSync(path.dirname(tomlPath), { recursive: true });
    fs.writeFileSync(tomlPath, '', 'utf-8');
  }
  vscode.workspace.openTextDocument(tomlPath).then(doc => {
    vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Active });
  });
}
