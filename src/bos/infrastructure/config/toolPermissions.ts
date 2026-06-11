export type ToolPermission = 'allow' | 'deny' | 'ask';

export interface ToolPermissionConfig {
  [toolName: string]: ToolPermission;
}

export interface McpServerConfig {
  name: string;
  type: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
}

export const DEFAULT_TOOL_PERMISSIONS: ToolPermissionConfig = {
  read_file: 'allow',
  list_dir: 'allow',
  grep_search: 'allow',
  glob_files: 'allow',
  ast_grep: 'allow',
  write_file: 'allow',
  load_skill: 'allow',
  edit_file: 'allow',
  ast_edit: 'allow',
  bash: 'ask',
  exec_tool: 'ask',
  triz_principles: 'allow',
  triz_parameters: 'allow',
  triz_contradiction: 'allow',
  triz_insight: 'allow',
  triz_su_field: 'allow',
  triz_ideality: 'allow',
  triz_s_curve: 'allow',
  triz_search: 'allow',
  papers_download: 'allow',
  papers_list_downloaded: 'allow',
  todowrite: 'allow',
  todoread: 'allow',
};

export function getToolName(tool: any): string {
  return tool.name || tool._name || '';
}

export function filterToolsByPermissions(
  tools: any[],
  permissions: ToolPermissionConfig,
): any[] {
  return tools.filter((tool) => {
    const name = getToolName(tool);
    const perm = permissions[name];
    if (perm === undefined) return true;
    return perm !== 'deny';
  });
}

export function getToolsRequiringApproval(
  tools: any[],
  permissions: ToolPermissionConfig,
): string[] {
  return tools
    .filter((tool) => {
      const name = getToolName(tool);
      return permissions[name] === 'ask';
    })
    .map(getToolName);
}

export function isToolAllowed(
  toolName: string,
  permissions: ToolPermissionConfig,
): boolean {
  const perm = permissions[toolName];
  if (perm !== undefined) return perm === 'allow';
  if (toolName.includes('__')) return false;
  return true;
}

export function mergePermissions(
  base: ToolPermissionConfig,
  override: ToolPermissionConfig,
): ToolPermissionConfig {
  return { ...base, ...override };
}

export interface ToolMetadata {
  description: string;
  dangerous: boolean;
  category: 'read' | 'write' | 'execute' | 'search' | 'triz' | 'other';
}

export const TOOL_METADATA: Record<string, ToolMetadata> = {
  read_file: { description: 'Read contents of a file', dangerous: false, category: 'read' },
  list_dir: { description: 'List files in a directory', dangerous: false, category: 'read' },
  grep_search: { description: 'Search for patterns in files', dangerous: false, category: 'search' },
  glob_files: { description: 'Find files matching a pattern', dangerous: false, category: 'search' },
  ast_grep: { description: 'Search code using AST patterns', dangerous: false, category: 'search' },
  write_file: { description: 'Create or overwrite a file', dangerous: true, category: 'write' },
  edit_file: { description: 'Modify contents of an existing file', dangerous: true, category: 'write' },
  ast_edit: { description: 'Edit code using AST patterns', dangerous: true, category: 'write' },
  bash: { description: 'Execute shell commands', dangerous: true, category: 'execute' },
  exec_tool: { description: 'Execute a tool from the tool registry', dangerous: true, category: 'execute' },
  triz_principles: { description: 'TRIZ inventive principles (get/search/list)', dangerous: false, category: 'triz' },
  triz_parameters: { description: 'TRIZ engineering parameters', dangerous: false, category: 'triz' },
  triz_contradiction: { description: 'Resolve technical contradiction (analyze/lookup/ai)', dangerous: false, category: 'triz' },
  triz_insight: { description: 'AI insight on applying a TRIZ principle', dangerous: false, category: 'triz' },
  triz_su_field: { description: 'Substance-Field analysis', dangerous: false, category: 'triz' },
  triz_ideality: { description: 'Score system ideality', dangerous: false, category: 'triz' },
  triz_s_curve: { description: 'S-curve technology analysis (analyze/extract/enrich)', dangerous: false, category: 'triz' },
  triz_search: { description: 'Search prior art (papers/patents/all, cache-first for papers/patents)', dangerous: false, category: 'triz' },
  papers_download: { description: 'Download a paper by DOI/arXiv/PMID/URL', dangerous: false, category: 'other' },
  papers_list_downloaded: { description: 'List downloaded papers', dangerous: false, category: 'other' },
  todowrite: { description: 'Create and manage a structured task list, persisted to disk', dangerous: false, category: 'other' },
  todoread: { description: 'Read the current todo list from disk', dangerous: false, category: 'other' },
};

export function getToolMetadata(toolName: string): ToolMetadata | null {
  return TOOL_METADATA[toolName] || null;
}

export interface BashIntent {
  action: string;
  target: string;
  risk: 'high' | 'medium' | 'low';
}

export function getBashIntent(args: Record<string, unknown> | string): BashIntent | null {
  let command = '';

  if (typeof args === 'string') {
    command = args;
  } else if (typeof args.command === 'string') {
    command = args.command;
  } else if (typeof args.cmd === 'string') {
    command = args.cmd;
  } else if (typeof args.bash === 'string') {
    command = args.bash;
  } else if (typeof args.script === 'string') {
    command = args.script;
  } else if (typeof args.code === 'string') {
    command = args.code;
  }

  if (!command) return null;

  const trimmed = command.trim();
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || '';
  const rest = parts.slice(1).join(' ');

  if (cmd === 'rm' || cmd === 'del' || cmd === 'erase') {
    const isRecursive = rest.includes('-r') || rest.includes('-rf') || rest.includes('-f') || rest.includes('-fr');
    const isForce = rest.includes('-f') || rest.includes('--force');
    const paths = rest.replace(/^-[^\s]*\s*/, '').trim();
    return {
      action: isRecursive ? 'DELETE files/folders recursively' : 'DELETE files/folders',
      target: paths || 'unspecified',
      risk: isRecursive || isForce ? 'high' : 'medium',
    };
  }

  if (cmd === 'rmdir' || cmd === 'rmdir') {
    const paths = rest.trim();
    return { action: 'DELETE directory', target: paths || 'unspecified', risk: 'medium' };
  }

  if (cmd === 'mv' || cmd === 'move') {
    return { action: 'MOVE/RENAME', target: rest || 'unspecified', risk: 'medium' };
  }

  if (cmd === 'cp' || cmd === 'copy' || cmd === 'cp -r') {
    return { action: 'COPY files', target: rest || 'unspecified', risk: 'medium' };
  }

  if (cmd === 'dd') {
    return { action: 'DIRECT DISK WRITE (extremely dangerous)', target: rest || 'unspecified', risk: 'high' };
  }

  if (cmd === 'mkfs' || cmd === 'format') {
    return { action: 'FORMAT disk', target: rest || 'unspecified', risk: 'high' };
  }

  if (cmd === 'chmod' || cmd === 'chown' || cmd === 'chgrp') {
    return { action: 'CHANGE permissions/owner', target: rest || 'unspecified', risk: 'medium' };
  }

  if (trimmed.startsWith('echo') && (trimmed.includes('>') || trimmed.includes('|'))) {
    return { action: 'WRITE to file', target: rest || 'unspecified', risk: 'medium' };
  }

  if (cmd === 'tee') {
    return { action: 'WRITE to file', target: rest || 'unspecified', risk: 'medium' };
  }

  if (cmd === 'wget' || cmd === 'curl') {
    return { action: 'DOWNLOAD from network', target: rest || 'unspecified', risk: 'low' };
  }

  if (cmd === 'git' && (rest.includes('push') || rest.includes('force-push'))) {
    return { action: 'PUSH to remote repository', target: rest.replace(/push.*$/, '').trim() || 'current repo', risk: 'high' };
  }

  if (cmd === 'git' && rest.includes('commit')) {
    return { action: 'COMMIT changes', target: rest.replace(/commit.*$/, '').trim() || 'current repo', risk: 'low' };
  }

  if (cmd === 'npm' && (rest.includes('install') || rest.includes('i'))) {
    return { action: 'INSTALL npm packages', target: rest.replace(/install.*$/, '').trim() || 'all dependencies', risk: 'medium' };
  }

  if (cmd === 'pip' && rest.includes('install')) {
    return { action: 'INSTALL Python packages', target: rest.replace(/install.*$/, '').trim() || 'unspecified', risk: 'medium' };
  }

  if (cmd === 'make' || cmd === 'cmake') {
    return { action: 'BUILD/COMPILE', target: rest || 'project', risk: 'low' };
  }

  if (cmd === 'ls' || cmd === 'dir' || cmd === 'find' || cmd === 'locate') {
    return { action: 'LIST/SEARCH files', target: rest || 'current directory', risk: 'low' };
  }

  if (cmd === 'cat' || cmd === 'head' || cmd === 'tail' || cmd === 'less' || cmd === 'more' || cmd === 'grep' || cmd === 'rg') {
    return { action: 'READ file contents', target: rest || 'unspecified', risk: 'low' };
  }

  if (cmd === 'cd' || cmd === 'pwd' || cmd === 'whoami' || cmd === 'id' || cmd === 'uname') {
    return { action: 'CHECK environment', target: rest || '', risk: 'low' };
  }

  if (cmd === 'ps' || cmd === 'top' || cmd === 'htop' || cmd === 'kill' || cmd === 'pkill') {
    return { action: 'MANAGE processes', target: rest || 'unspecified', risk: 'medium' };
  }

  if (cmd === 'docker') {
    if (rest.includes('rm') || rest.includes('rmi')) {
      return { action: 'DELETE Docker container/image', target: rest || 'unspecified', risk: 'high' };
    }
    if (rest.includes('run')) {
      return { action: 'RUN Docker container', target: rest.replace(/run.*$/, '').trim() || 'unspecified', risk: 'medium' };
    }
    return { action: 'DOCKER command', target: rest || 'unspecified', risk: 'medium' };
  }

  if (cmd === 'sudo' || cmd === 'su') {
    return { action: 'RUN as superuser', target: rest || 'unspecified', risk: 'high' };
  }

  return {
    action: 'EXECUTE command',
    target: rest || cmd,
    risk: 'low',
  };
}

export function getAskToolNames(permissions: ToolPermissionConfig): Set<string> {
  return new Set(
    Object.entries(permissions)
      .filter(([, perm]) => perm === 'ask')
      .map(([name]) => name)
  );
}
