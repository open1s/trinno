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
  write_file: 'ask',
  edit_file: 'ask',
  ast_edit: 'ask',
  bash: 'ask',
  exec_tool: 'ask',
  triz_analyze_contradiction: 'allow',
  triz_lookup_matrix: 'allow',
  triz_get_principle: 'allow',
  triz_search_principles: 'allow',
  triz_list_principles: 'allow',
  triz_list_parameters: 'allow',
  triz_analyze_su_field: 'allow',
  triz_evaluate_ideality: 'allow',
  triz_ai_analyze: 'allow',
  triz_ai_insight: 'allow',
  triz_trigger_search_patents: 'allow',
  triz_trigger_search_papers: 'allow',
  triz_trigger_search_prior_art: 'allow',
  triz_get_cached_patents: 'allow',
  triz_get_cached_papers: 'allow',
  triz_get_cached_prior_art: 'allow',
  triz_list_cached_searches: 'allow',
  triz_analyze_s_curve: 'allow',
  triz_extract_s_curve_data: 'allow',
  triz_enrich_s_curve: 'allow',
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

export function getAskToolNames(permissions: ToolPermissionConfig): Set<string> {
  return new Set(
    Object.entries(permissions)
      .filter(([, perm]) => perm === 'ask')
      .map(([name]) => name)
  );
}
