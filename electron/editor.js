'use strict';
// @ts-check
/**
 * External editor integration: opens agent worktrees in either Visual Studio Code,
 * Google Antigravity IDE, or the system default file manager.
 *
 * Privacy Invariant: NEVER hardcode local user paths. All paths are resolved dynamically
 * from environment variables (LOCALAPPDATA, ProgramFiles) or system PATH.
 * Security Invariant: NEVER invoke via shell strings (exec/cmd.exe); always use direct spawn
 * with argument arrays to prevent shell injection.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

/**
 * Checks whether an executable exists or is accessible on PATH.
 * @param {string} cmd
 * @returns {string|null}
 */
function findOnPath(cmd) {
  try {
    const isWin = process.platform === 'win32';
    const lookup = isWin ? 'where.exe' : 'which';
    const out = execFileSync(lookup, [cmd], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    });
    const firstLine = out.trim().split(/\r?\n/)[0];
    return firstLine && fs.existsSync(firstLine) ? firstLine : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the executable path for the requested editor choice.
 * @param {'vscode' | 'antigravity' | 'system' | string} [choice]
 * @returns {{ bin: string, name: string, type: 'cli' | 'system' }}
 */
function resolveEditor(choice = 'vscode') {
  const isWin = process.platform === 'win32';

  if (choice === 'antigravity') {
    // 1. Check PATH
    const onPath = findOnPath(isWin ? 'antigravity-ide.cmd' : 'antigravity-ide')
      || findOnPath('antigravity');
    if (onPath) {
      return { bin: onPath, name: 'Antigravity IDE', type: 'cli' };
    }

    // 2. Check Windows common install locations without hardcoded user paths
    if (isWin) {
      const localApp = process.env.LOCALAPPDATA || '';
      const progFiles = process.env.ProgramFiles || '';
      const candidates = [
        path.join(localApp, 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
        path.join(localApp, 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe'),
        path.join(progFiles, 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
        path.join(progFiles, 'Antigravity IDE', 'Antigravity IDE.exe'),
      ];
      for (const cand of candidates) {
        if (cand && fs.existsSync(cand)) {
          return { bin: cand, name: 'Antigravity IDE', type: 'cli' };
        }
      }
    }
  }

  if (choice === 'vscode' || !choice) {
    // 1. Check PATH
    const onPath = findOnPath(isWin ? 'code.cmd' : 'code');
    if (onPath) {
      return { bin: onPath, name: 'Visual Studio Code', type: 'cli' };
    }

    // 2. Check Windows common install locations
    if (isWin) {
      const localApp = process.env.LOCALAPPDATA || '';
      const progFiles = process.env.ProgramFiles || '';
      const progFilesX86 = process.env['ProgramFiles(x86)'] || '';
      const candidates = [
        path.join(localApp, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
        path.join(localApp, 'Programs', 'Microsoft VS Code', 'Code.exe'),
        path.join(progFiles, 'Microsoft VS Code', 'bin', 'code.cmd'),
        path.join(progFiles, 'Microsoft VS Code', 'Code.exe'),
        path.join(progFilesX86, 'Microsoft VS Code', 'bin', 'code.cmd'),
      ];
      for (const cand of candidates) {
        if (cand && fs.existsSync(cand)) {
          return { bin: cand, name: 'Visual Studio Code', type: 'cli' };
        }
      }
    }
  }

  return { bin: 'system', name: 'Explorador del sistema', type: 'system' };
}

/**
 * Opens a folder or file in the configured external editor.
 *
 * @param {object} opts
 * @param {string} opts.targetPath Directory or file path to open
 * @param {string} [opts.filePath] Specific file to focus
 * @param {number} [opts.line] Line number to focus
 * @param {'vscode' | 'antigravity' | 'system' | string} [opts.editorChoice]
 * @param {any} [opts.shell] Electron shell module (optional, for system open)
 * @returns {Promise<{ ok: boolean, editor?: string, error?: string, fallback?: boolean }>}
 */
async function openInEditor({ targetPath, filePath, line, editorChoice = 'vscode', shell = null }) {
  if (!targetPath) {
    return { ok: false, error: 'No se proporcionó ruta para abrir' };
  }

  const resolvedTarget = path.resolve(targetPath);
  if (!fs.existsSync(resolvedTarget)) {
    return { ok: false, error: `La ruta no existe en disco: ${path.basename(resolvedTarget)}` };
  }

  const resolved = resolveEditor(editorChoice);

  if (resolved.type === 'system' || resolved.bin === 'system') {
    if (shell && typeof shell.openPath === 'function') {
      const err = await shell.openPath(resolvedTarget);
      if (err) return { ok: false, error: err };
      return { ok: true, editor: 'Explorador del sistema' };
    }
    return fallbackSystemOpen(resolvedTarget);
  }

  try {
    const args = [resolvedTarget];
    if (filePath) {
      const relOrAbsFile = path.isAbsolute(filePath) ? filePath : path.join(resolvedTarget, filePath);
      if (fs.existsSync(relOrAbsFile)) {
        args.push('-g', `${relOrAbsFile}:${line || 1}`);
      }
    }

    const child = spawn(resolved.bin, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    return { ok: true, editor: resolved.name };
  } catch (err) {
    // If CLI launch failed, gracefully fall back to system file explorer
    if (shell && typeof shell.openPath === 'function') {
      await shell.openPath(resolvedTarget);
      return { ok: true, editor: 'Explorador del sistema', fallback: true };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Fallback open using OS-level command if Electron shell is not passed.
 * @param {string} target
 */
function fallbackSystemOpen(target) {
  try {
    if (process.platform === 'win32') {
      const child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' });
      child.unref();
    } else if (process.platform === 'darwin') {
      const child = spawn('open', [target], { detached: true, stdio: 'ignore' });
      child.unref();
    } else {
      const child = spawn('xdg-open', [target], { detached: true, stdio: 'ignore' });
      child.unref();
    }
    return { ok: true, editor: 'Explorador del sistema' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

module.exports = {
  findOnPath,
  resolveEditor,
  openInEditor,
};
