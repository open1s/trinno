import * as fs from 'fs';
import * as path from 'path';

export interface FileReferenceTarget {
  text: string;
  workspaceRoot: string;
  referencePath: string;
}

const FILE_REFERENCE_PATTERN = /(^|\s)@file:(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function stripFileReference(text: string, referenceText: string): string {
  return text.replace(referenceText, ' ').replace(/\s+/g, ' ').trim();
}

export function resolveCommandFileReference(text: string, workspaceRoot: string | undefined): FileReferenceTarget | null {
  if (!workspaceRoot || !text.trimStart().startsWith('/')) {
    return null;
  }

  let match: RegExpExecArray | null;
  FILE_REFERENCE_PATTERN.lastIndex = 0;
  while ((match = FILE_REFERENCE_PATTERN.exec(text)) !== null) {
    const prefix = match[1] ?? '';
    const referencePath = match[2] ?? match[3] ?? match[4];
    const fullMatch = match[0];
    if (!referencePath) continue;

    const resolvedPath = path.resolve(workspaceRoot, referencePath);
    if (!isWithinRoot(resolvedPath, workspaceRoot)) {
      continue;
    }

    if (!fs.existsSync(resolvedPath)) {
      continue;
    }

    const stats = fs.statSync(resolvedPath);
    const targetRoot = stats.isDirectory() ? resolvedPath : path.dirname(resolvedPath);

    return {
      text: stripFileReference(text, fullMatch.slice(prefix.length)),
      workspaceRoot: targetRoot,
      referencePath,
    };
  }

  return null;
}
