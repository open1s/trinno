import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';

export interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity: number;
  message: string;
  source?: string;
}

export interface LspDiagnostics {
  uri: string;
  diagnostics: LspDiagnostic[];
}

export class TypstLspClient extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private pendingRequests = new Map<string, { resolve: (result: any) => void; reject: (error: any) => void }>();
  private notificationHandlers = new Map<string, (params: any) => void>();
  private requestId = 0;
  private initialized = false;
  private workspaceRoot: string;
  private documentDiagnostics = new Map<string, LspDiagnostic[]>();

  constructor(workspaceRoot: string = process.cwd()) {
    super();
    this.workspaceRoot = workspaceRoot;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;
      let resolved = false;
      
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
      };
      
      const resolveOnce = () => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve();
        }
      };
      
      const rejectOnce = (err: Error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(err);
        }
      };
      
      timeoutId = setTimeout(() => {
        rejectOnce(new Error('LSP initialization timed out after 10s'));
      }, 10000);

      try {
        this.process = spawn('tinymist', ['lsp'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, RUST_BACKTRACE: '1' },
        });

        let buffer = '';
        let contentLength = -1;

        this.process.stdout?.on('data', (data: Buffer) => {
          buffer += data.toString();

          while (true) {
            if (contentLength < 0) {
              const headerEnd = buffer.indexOf('\r\n\r\n');
              if (headerEnd < 0) break;

              const header = buffer.slice(0, headerEnd);
              const match = header.match(/Content-Length: (\d+)/i);
              if (!match) {
                console.error('[tinymist] no Content-Length header:', header);
                buffer = headerEnd + 4 < buffer.length ? buffer.slice(headerEnd + 4) : '';
                continue;
              }
              contentLength = parseInt(match[1]!, 10);
              buffer = buffer.slice(headerEnd + 4);
            }

            if (contentLength >= 0 && buffer.length >= contentLength) {
              const content = buffer.slice(0, contentLength);
              buffer = buffer.slice(contentLength);
              contentLength = -1;
              try {
                this.handleMessage(JSON.parse(content));
              } catch (e) {
                console.error('[tinymist] failed to parse:', content);
              }
            } else {
              break;
            }
          }
        });

        this.process.stderr?.on('data', (data: Buffer) => {
          console.error('[tinymist stderr]', data.toString().slice(0, 200));
        });

        this.process.on('error', (err) => {
          console.error('[tinymist error]', err);
          rejectOnce(err);
        });

        this.process.on('exit', (code, signal) => {
          console.error(`[tinymist exited] code=${code} signal=${signal}`);
          this.initialized = false;
          this.emit('exit', { code, signal });
        });

        this.sendRequest('initialize', {
          processId: process.pid,
          workspaceFolders: [{ uri: `file://${this.workspaceRoot}`, name: 'workspace' }],
          capabilities: {},
        }).then((result: any) => {
          console.error('[tinymist] initialized successfully');
          this.initialized = true;
          this.sendNotification('initialized', {});
          resolveOnce();
        }).catch((err) => {
          console.error('[tinymist] init error:', err);
          rejectOnce(err);
        });

      } catch (err) {
        rejectOnce(err as Error);
      }
    });
  }

  stop(): void {
    if (this.process) {
      this.sendRequest('shutdown', {}).then(() => {
        this.process?.kill();
        this.process = null;
        this.initialized = false;
      }).catch(() => {
        this.process?.kill();
        this.process = null;
        this.initialized = false;
      });
    }
  }

  openDocument(uri: string, content: string): void {
    this.sendNotification('textDocument/didOpen', {
      textDocument: { uri, text: content, version: 1, languageId: 'typst' },
    });
  }

  saveDocument(uri: string): void {
    this.sendNotification('textDocument/didSave', {
      textDocument: { uri },
    });
  }

  notifyChange(uri: string, content: string, version: number = 1): void {
    this.sendNotification('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text: content }],
    });
  }

  closeDocument(uri: string): void {
    this.sendNotification('textDocument/didClose', {
      textDocument: { uri },
    });
  }

  getDiagnostics(uri: string): LspDiagnostic[] {
    return this.documentDiagnostics.get(uri) || [];
  }

  async requestDiagnostics(uri: string, content: string, timeoutMs: number = 5000): Promise<LspDiagnostic[]> {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(this.getDiagnostics(uri));
        }
      }, timeoutMs);

      const handler = (params: LspDiagnostics) => {
        if (settled) return;
        if (params.uri === uri) {
          settled = true;
          clearTimeout(timer);
          resolve(params.diagnostics);
        }
      };

      const orig = this.notificationHandlers.get('textDocument/publishDiagnostics');
      this.notificationHandlers.set('textDocument/publishDiagnostics', (params) => {
        orig?.(params);
        handler(params);
      });

      this.openDocument(uri, content);
      this.saveDocument(uri);
    });
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  onPublishDiagnostics(handler: (diagnostics: LspDiagnostics) => void): void {
    this.notificationHandlers.set('textDocument/publishDiagnostics', (params) => {
      const diagnostics: LspDiagnostic[] = params.diagnostics || [];
      this.documentDiagnostics.set(params.uri, diagnostics);
      handler({ uri: params.uri, diagnostics });
    });
  }

  private sendMessage(message: any): void {
    if (!this.process) return;
    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    this.process.stdin.write(header + content);
  }

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process) {
        reject(new Error('Process not started'));
        return;
      }
      const id = String(++this.requestId);
      this.pendingRequests.set(id, { resolve, reject });
      this.sendMessage({ jsonrpc: '2.0', id, method, params });
    });
  }

  private sendNotification(method: string, params: any): void {
    this.sendMessage({ jsonrpc: '2.0', method, params });
  }

  private parseHeaders(): { contentLength: number; headers: Record<string, string> } | null {
    if (!this.process?.stdout) return null;
    // handled in stream parsing, see stdout 'data' handler
    return null;
  }

  private handleMessage(message: any): void {
    if (message.id) {
      const pending = this.pendingRequests.get(String(message.id));
      if (pending) {
        this.pendingRequests.delete(String(message.id));
        if (message.error) {
          pending.reject(message.error);
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.method) {
      const handler = this.notificationHandlers.get(message.method);
      if (handler) {
        handler(message.params);
      }
    }
  }
}

let globalLspClient: TypstLspClient | null = null;

export async function getTypstLspClient(workspaceRoot?: string): Promise<TypstLspClient> {
  if (!globalLspClient) {
    globalLspClient = new TypstLspClient(workspaceRoot || process.cwd());
    globalLspClient.onPublishDiagnostics((params) => {
      console.error(`[typst-lsp] diagnostics for ${params.uri}: ${params.diagnostics.length} issues`);
    });
    globalLspClient.on('error', (err) => {
      console.error('[typst-lsp] error', err);
    });
    globalLspClient.on('exit', ({ code, signal }) => {
      console.error(`[typst-lsp] exited code=${code} signal=${signal}`);
      globalLspClient = null;
    });
    await globalLspClient.start();
  }
  return globalLspClient;
}

export async function closeTypstLspClient(): Promise<void> {
  if (globalLspClient) {
    globalLspClient.stop();
    globalLspClient = null;
  }
}