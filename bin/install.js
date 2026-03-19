#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Colors
const cyan = '\x1b[36m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

// Get version from package.json
const pkg = require('../package.json');

// Parse args
const args = process.argv.slice(2);
const hasGlobal = args.includes('--global') || args.includes('-g');
const hasLocal = args.includes('--local') || args.includes('-l');
const hasOpencode = args.includes('--opencode') || args.includes('-o');
const hasClaude = args.includes('--claude') || args.includes('-c');
const hasBoth = args.includes('--both') || args.includes('-b');
const hasUninstall = args.includes('--uninstall') || args.includes('-u');
const hasHelp = args.includes('--help') || args.includes('-h');

const hasPlatformFlag = hasOpencode || hasClaude || hasBoth;
const hasScopeFlag = hasGlobal || hasLocal;

function platformLabel(platform) {
  if (platform === 'both') return 'Both';
  if (platform === 'opencode') return 'OpenCode';
  if (platform === 'claude') return 'Claude Code';
  return 'AI Coding IDE';
}

function printBanner(platform) {
  // Inner content: 'Python Infra Audit for <label>' padded to 36 chars
  // Box: ╔════════════════════════════════════════╗ (40 ═, total line width 42 with corners)
  // Content line: ║  <36 chars>  ║ = 42 chars — always aligned
  const label = 'Python Infra Audit for ' + platformLabel(platform);
  const inner = label.padEnd(36);
  const banner = '\n' +
    cyan + '  ╔════════════════════════════════════════╗\n' +
    '  ║  ' + inner + '  ║\n' +
    '  ╚════════════════════════════════════════╝' + reset + '\n' +
    '\n' +
    '  python-infra-audit-cc ' + dim + 'v' + pkg.version + reset + '\n';
  console.log(banner);
}

// Always print banner at startup
printBanner(hasBoth ? 'both' : hasOpencode ? 'opencode' : hasClaude ? 'claude' : null);

// Show help if requested
if (hasHelp) {
  console.log(`  ${yellow}Usage:${reset} npx python-infra-audit-cc [options]\n
  ${yellow}Interactive (recommended):${reset}
    npx python-infra-audit-cc
    ${dim}Prompts for platform (Claude Code / OpenCode / Both),${reset}
    ${dim}then for scope (Global / Local) with resolved paths.${reset}
    ${dim}Any flag below skips the corresponding question.${reset}

  ${yellow}Platform flags:${reset}
    ${cyan}-c, --claude${reset}      Claude Code only
    ${cyan}-o, --opencode${reset}    OpenCode only
    ${cyan}-b, --both${reset}        Both Claude Code and OpenCode

  ${yellow}Scope flags:${reset}
    ${cyan}-g, --global${reset}      Install globally
    ${cyan}-l, --local${reset}       Install locally to current project only

  ${yellow}Other flags:${reset}
    ${cyan}-u, --uninstall${reset}   Remove all infra-audit files
    ${cyan}-h, --help${reset}        Show this help message

  ${yellow}Examples:${reset}
    ${dim}# Fully interactive${reset}
    npx python-infra-audit-cc

    ${dim}# Pick platform, still asks global/local${reset}
    npx python-infra-audit-cc --claude
    npx python-infra-audit-cc --opencode

    ${dim}# Fully non-interactive${reset}
    npx python-infra-audit-cc --claude --global
    npx python-infra-audit-cc --opencode --local
    npx python-infra-audit-cc --both --global

    ${dim}# Uninstall (interactive or explicit)${reset}
    npx python-infra-audit-cc --uninstall
    npx python-infra-audit-cc --claude --global --uninstall
    npx python-infra-audit-cc --opencode --global --uninstall

  ${yellow}After install:${reset}
    Run ${cyan}/infra-audit${reset} in Claude Code or OpenCode
`);
  process.exit(0);
}

// Validate args
if (hasGlobal && hasLocal) {
  console.error(`  ${yellow}Cannot specify both --global and --local${reset}`);
  process.exit(1);
}

if ((hasOpencode && hasClaude) || (hasOpencode && hasBoth) || (hasClaude && hasBoth)) {
  console.error(`  ${yellow}Cannot combine --claude, --opencode, and --both — pick one${reset}`);
  process.exit(1);
}

// ──────────────────────────────────────────────────────
// Interactive menus
// ──────────────────────────────────────────────────────

function showPlatformMenu() {
  return new Promise((resolve) => {
    const readline = require('readline');

    console.log(`  ${yellow}Step 1 of 2 — Choose platform:${reset}\n`);
    console.log(`    ${cyan}1)${reset} Claude Code`);
    console.log(`    ${cyan}2)${reset} OpenCode`);
    console.log(`    ${cyan}3)${reset} Both`);
    console.log(`    ${cyan}4)${reset} Cancel\n`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`  ${dim}Enter choice [1-4]:${reset} `, (answer) => {
      rl.close();
      const choice = answer.trim();
      if (choice === '1') resolve('claude');
      else if (choice === '2') resolve('opencode');
      else if (choice === '3') resolve('both');
      else resolve('cancel');
    });
  });
}

function showScopeMenu(platform) {
  return new Promise((resolve) => {
    const readline = require('readline');

    // Build path hints based on platform
    const home = os.homedir();
    const cwd = process.cwd();
    let globalPaths, localPaths;

    if (platform === 'both') {
      globalPaths = `~/.claude/  and  ~/.config/opencode/`;
      localPaths  = `./.claude/  and  ./.opencode/  ${dim}(in ${cwd})${reset}`;
    } else if (platform === 'opencode') {
      const globalDir = process.env.OPENCODE_CONFIG_DIR
        ? (process.env.OPENCODE_CONFIG_DIR.startsWith('~/')
            ? process.env.OPENCODE_CONFIG_DIR
            : process.env.OPENCODE_CONFIG_DIR.replace(home, '~'))
        : '~/.config/opencode/';
      globalPaths = globalDir;
      localPaths  = `./.opencode/  ${dim}(in ${cwd})${reset}`;
    } else {
      const globalDir = process.env.CLAUDE_CONFIG_DIR
        ? (process.env.CLAUDE_CONFIG_DIR.startsWith('~/')
            ? process.env.CLAUDE_CONFIG_DIR
            : process.env.CLAUDE_CONFIG_DIR.replace(home, '~'))
        : '~/.claude/';
      globalPaths = globalDir;
      localPaths  = `./.claude/  ${dim}(in ${cwd})${reset}`;
    }

    console.log('');
    console.log(`  ${yellow}Step 2 of 2 — Choose scope:${reset}\n`);
    console.log(`    ${cyan}1)${reset} Global  →  ${globalPaths}`);
    console.log(`    ${cyan}2)${reset} Local   →  ${localPaths}`);
    console.log(`    ${cyan}3)${reset} Cancel\n`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`  ${dim}Enter choice [1-3]:${reset} `, (answer) => {
      rl.close();
      const choice = answer.trim();
      if (choice === '1') resolve('global');
      else if (choice === '2') resolve('local');
      else resolve('cancel');
    });
  });
}

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

/**
 * Get the config directory path
 */
function getConfigDir(isGlobal, isOpencode) {
  if (isOpencode) {
    if (isGlobal) {
      if (process.env.OPENCODE_CONFIG_DIR) {
        const dir = process.env.OPENCODE_CONFIG_DIR;
        return dir.startsWith('~/') ? path.join(os.homedir(), dir.slice(2)) : dir;
      }
      return path.join(os.homedir(), '.config', 'opencode');
    }
    return path.join(process.cwd(), '.opencode');
  }
  if (isGlobal) {
    if (process.env.CLAUDE_CONFIG_DIR) {
      const dir = process.env.CLAUDE_CONFIG_DIR;
      return dir.startsWith('~/') ? path.join(os.homedir(), dir.slice(2)) : dir;
    }
    return path.join(os.homedir(), '.claude');
  }
  return path.join(process.cwd(), '.claude');
}

/**
 * Read and parse settings.json
 */
function readSettings(settingsPath) {
  if (fs.existsSync(settingsPath)) {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

/**
 * Write settings.json with proper formatting
 */
function writeSettings(settingsPath, settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

/**
 * Compute SHA256 hash of file contents
 */
function fileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Build a hook command path
 */
function buildHookCommand(configDir, hookName) {
  const hooksPath = configDir.replace(/\\/g, '/') + '/hooks/' + hookName;
  return `node "${hooksPath}"`;
}

/**
 * Recursively collect all files with their hashes
 */
function generateManifest(dir, baseDir) {
  if (!baseDir) baseDir = dir;
  const manifest = {};
  if (!fs.existsSync(dir)) return manifest;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      Object.assign(manifest, generateManifest(fullPath, baseDir));
    } else {
      manifest[relPath] = fileHash(fullPath);
    }
  }
  return manifest;
}

/**
 * Transform skill markdown content for OpenCode.
 * - Rewrite frontmatter: keep only name + description (OpenCode skill spec)
 */
function transformForOpencode(content) {
  // Rewrite frontmatter: keep only name + description
  content = content.replace(/^---\n([\s\S]*?)\n---/, (match, fm) => {
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    const descMatch = fm.match(/^description:\s*(.+)$/m);
    const parts = [];
    if (nameMatch) parts.push(`name: ${nameMatch[1]}`);
    if (descMatch) parts.push(`description: ${descMatch[1]}`);
    return `---\n${parts.join('\n')}\n---`;
  });

  return content;
}

// ──────────────────────────────────────────────────────
// Constants — files we own
// ──────────────────────────────────────────────────────

const MANIFEST_NAME = 'infra-audit-manifest.json';
const PATCHES_DIR_NAME = 'infra-audit-local-patches';

// Skill names (source files live at skills/infra-{name}/SKILL.md)
const SKILL_NAMES = ['audit', 'fix', 'status', 'update', 'update-versions'];

// Files we install (relative to config dir) — Claude Code layout
const OUR_FILES = [
  'skills/infra-audit/SKILL.md',
  'skills/infra-fix/SKILL.md',
  'skills/infra-status/SKILL.md',
  'skills/infra-update/SKILL.md',
  'skills/infra-update-versions/SKILL.md',
  'infra/blueprint.md',
  'infra/blueprints/ci.yml',
  'infra/blueprints/renovate.yml',
  'infra/scripts/detect.sh',
  'infra/scripts/verify.sh',
  'infra/versions.yml',
  'infra/VERSION',
  'hooks/infra-check-update.js',
  MANIFEST_NAME,
];

// Files we install (relative to config dir) — OpenCode layout (no hooks)
const OUR_FILES_OPENCODE = [
  'skills/infra-audit/SKILL.md',
  'skills/infra-fix/SKILL.md',
  'skills/infra-status/SKILL.md',
  'skills/infra-update/SKILL.md',
  'skills/infra-update-versions/SKILL.md',
  'infra/blueprint.md',
  'infra/blueprints/ci.yml',
  'infra/blueprints/renovate.yml',
  'infra/scripts/detect.sh',
  'infra/scripts/verify.sh',
  'infra/versions.yml',
  'infra/VERSION',
  MANIFEST_NAME,
];

// Legacy layout files (for cleanup on upgrade from commands → skills)
const LEGACY_FILES_CLAUDE = [
  'commands/infra/audit.md',
  'commands/infra/fix.md',
  'commands/infra/status.md',
  'commands/infra/update.md',
  'commands/infra/update-versions.md',
];

const LEGACY_FILES_OPENCODE = [
  'commands/infra-audit.md',
  'commands/infra-fix.md',
  'commands/infra-status.md',
  'commands/infra-update.md',
  'commands/infra-update-versions.md',
];

// Legacy directories to clean up (only if empty after file removal)
const LEGACY_DIRS_CLAUDE = [
  'commands/infra',    // check first (inner)
];

const LEGACY_DIRS_OPENCODE = [];  // flat layout, no subdirs to clean

// ──────────────────────────────────────────────────────
// Local Patch Persistence
// ──────────────────────────────────────────────────────

/**
 * Detect user-modified files by comparing against install manifest.
 * Back up modified files before overwriting.
 */
function saveLocalPatches(configDir) {
  const manifestPath = path.join(configDir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return [];

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return []; }

  const patchesDir = path.join(configDir, PATCHES_DIR_NAME);
  const modified = [];

  for (const [relPath, originalHash] of Object.entries(manifest.files || {})) {
    const fullPath = path.join(configDir, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const currentHash = fileHash(fullPath);
    if (currentHash !== originalHash) {
      const backupPath = path.join(patchesDir, relPath);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(fullPath, backupPath);
      modified.push(relPath);
    }
  }

  if (modified.length > 0) {
    const meta = {
      backed_up_at: new Date().toISOString(),
      from_version: manifest.version,
      files: modified,
    };
    fs.writeFileSync(path.join(patchesDir, 'backup-meta.json'), JSON.stringify(meta, null, 2));
    console.log(`  ${yellow}i${reset} Found ${modified.length} locally modified file(s) — backed up to ${PATCHES_DIR_NAME}/`);
    for (const f of modified) {
      console.log(`     ${dim}${f}${reset}`);
    }
  }
  return modified;
}

/**
 * After install, report backed-up patches for user to reapply.
 */
function reportLocalPatches(configDir) {
  const patchesDir = path.join(configDir, PATCHES_DIR_NAME);
  const metaPath = path.join(patchesDir, 'backup-meta.json');
  if (!fs.existsSync(metaPath)) return;

  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { return; }

  if (meta.files && meta.files.length > 0) {
    console.log('');
    console.log(`  ${yellow}Local patches detected${reset} (from v${meta.from_version}):`);
    for (const f of meta.files) {
      console.log(`     ${cyan}${f}${reset}`);
    }
    console.log('');
    console.log(`  Your modifications are saved in ${cyan}${PATCHES_DIR_NAME}/${reset}`);
    console.log(`  Manually compare and merge the files if needed.`);
    console.log('');
  }
}

/**
 * Remove legacy command files from a previous install.
 * Only removes files that are in the OLD manifest AND match the old layout.
 * Backs up user-modified files before removal.
 */
function cleanupLegacyCommands(configDir, isOpencode) {
  const manifestPath = path.join(configDir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return;

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return; }

  // Only run cleanup if the old manifest contains command-layout files
  const legacyFiles = isOpencode ? LEGACY_FILES_OPENCODE : LEGACY_FILES_CLAUDE;
  const legacyDirs = isOpencode ? LEGACY_DIRS_OPENCODE : LEGACY_DIRS_CLAUDE;

  const hasLegacyLayout = legacyFiles.some(f => manifest.files && manifest.files[f]);
  if (!hasLegacyLayout) return;

  console.log(`  ${yellow}Upgrading from commands/ to skills/ layout...${reset}`);

  let removedCount = 0;

  for (const relPath of legacyFiles) {
    const fullPath = path.join(configDir, relPath);
    if (!fs.existsSync(fullPath)) continue;

    // Only delete if this file is in our manifest
    if (!manifest.files || !manifest.files[relPath]) {
      console.log(`  ${dim}─${reset} Skipping ${relPath} (not in manifest)`);
      continue;
    }

    // Check if user modified it
    const currentHash = fileHash(fullPath);
    if (currentHash !== manifest.files[relPath]) {
      // Back up modified file
      const patchesDir = path.join(configDir, PATCHES_DIR_NAME);
      const backupPath = path.join(patchesDir, relPath);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(fullPath, backupPath);
      console.log(`  ${yellow}i${reset} Backed up modified ${relPath}`);
    }

    fs.unlinkSync(fullPath);
    removedCount++;
    console.log(`  ${green}✓${reset} Removed legacy ${relPath}`);
  }

  // Clean up empty legacy directories (inner-first)
  for (const relDir of legacyDirs) {
    const dirPath = path.join(configDir, relDir);
    if (fs.existsSync(dirPath)) {
      try {
        const remaining = fs.readdirSync(dirPath);
        if (remaining.length === 0) {
          fs.rmdirSync(dirPath);
          console.log(`  ${green}✓${reset} Removed empty directory ${relDir}/`);
        } else {
          console.log(`  ${dim}─${reset} Kept ${relDir}/ (contains other files)`);
        }
      } catch (e) {
        // Directory might have been removed already, that's fine
      }
    }
  }

  if (removedCount > 0) {
    console.log(`  ${green}✓${reset} Legacy cleanup complete (${removedCount} file(s))\n`);
  }
}

// ──────────────────────────────────────────────────────
// Install
// ──────────────────────────────────────────────────────

function install(isGlobal, isOpencode) {
  const src = path.join(__dirname, '..');
  const configDir = getConfigDir(isGlobal, isOpencode);

  const locationLabel = isGlobal
    ? configDir.replace(os.homedir(), '~')
    : configDir.replace(process.cwd(), '.');

  // Path prefix for @file references in markdown content
  const pathPrefix = isGlobal
    ? `${configDir.replace(/\\/g, '/')}/`
    : isOpencode ? './.opencode/' : './.claude/';

  console.log(`  Installing to ${cyan}${locationLabel}${reset}\n`);

  // Save any locally modified files before overwriting
  saveLocalPatches(configDir);

  // Clean up legacy commands/ layout if upgrading
  cleanupLegacyCommands(configDir, isOpencode);

  // Track failures
  const failures = [];

  // Track installed files for manifest
  const installedFiles = [];

  // ── 1. Skill files ──
  for (const name of SKILL_NAMES) {
    const skillSrc = path.join(src, 'skills', `infra-${name}`, 'SKILL.md');
    const destRelPath = `skills/infra-${name}/SKILL.md`;
    const destFull = path.join(configDir, destRelPath);

    fs.mkdirSync(path.dirname(destFull), { recursive: true });

    let content = fs.readFileSync(skillSrc, 'utf8');
    // Path template: replace ~/.claude/ with the actual install path
    content = content.replace(/~\/\.claude\//g, pathPrefix);

    if (isOpencode) {
      // Replace $HOME/.claude/ with OpenCode path for bash runtime references
      content = content.replace(/\$HOME\/\.claude\//g, '$HOME/.config/opencode/');
      // Replace ./.claude/ with ./.opencode/ for local project references
      content = content.replace(/\.\/\.claude\//g, './.opencode/');
      // Transform frontmatter for OpenCode
      content = transformForOpencode(content);
      // update SKILL.md: rewrite --claude → --opencode for OpenCode context
      if (name === 'update') {
        content = content.replace(/--claude/g, '--opencode');
      }
    }

    fs.writeFileSync(destFull, content);
    if (fs.existsSync(destFull)) {
      console.log(`  ${green}✓${reset} Installed ${destRelPath}`);
      installedFiles.push({ rel: destRelPath, abs: destFull });
    } else {
      failures.push(destRelPath);
    }
  }

  // ── 2. infra/blueprints/*.yml ──
  const blueprintsDir = path.join(src, 'infra', 'blueprints');
  const blueprintsDest = path.join(configDir, 'infra', 'blueprints');
  fs.mkdirSync(blueprintsDest, { recursive: true });
  for (const ymlName of ['ci.yml', 'renovate.yml']) {
    const ymlSrc = path.join(blueprintsDir, ymlName);
    const ymlDest = path.join(blueprintsDest, ymlName);
    fs.copyFileSync(ymlSrc, ymlDest);
    if (fs.existsSync(ymlDest)) {
      console.log(`  ${green}✓${reset} Installed infra/blueprints/${ymlName}`);
      installedFiles.push({ rel: `infra/blueprints/${ymlName}`, abs: ymlDest });
    } else {
      failures.push(`infra/blueprints/${ymlName}`);
    }
  }

  // ── 3. infra/blueprint.md (preserves infra/history/) ──
  const blueprintSrc = path.join(src, 'infra', 'blueprint.md');
  const blueprintDest = path.join(configDir, 'infra', 'blueprint.md');
  fs.mkdirSync(path.dirname(blueprintDest), { recursive: true });
  fs.copyFileSync(blueprintSrc, blueprintDest);
  if (fs.existsSync(blueprintDest)) {
    console.log(`  ${green}✓${reset} Installed infra/blueprint.md`);
    installedFiles.push({ rel: 'infra/blueprint.md', abs: blueprintDest });
  } else {
    failures.push('infra/blueprint.md');
  }

  // ── 4. infra/versions.yml ──
  const versionsSrc = path.join(src, 'infra', 'versions.yml');
  const versionsDest = path.join(configDir, 'infra', 'versions.yml');
  fs.copyFileSync(versionsSrc, versionsDest);
  if (fs.existsSync(versionsDest)) {
    console.log(`  ${green}✓${reset} Installed infra/versions.yml`);
    installedFiles.push({ rel: 'infra/versions.yml', abs: versionsDest });
  } else {
    failures.push('infra/versions.yml');
  }

  // ── 5. infra/scripts/*.sh ──
  const scriptsDir = path.join(src, 'infra', 'scripts');
  const scriptsDest = path.join(configDir, 'infra', 'scripts');
  fs.mkdirSync(scriptsDest, { recursive: true });
  for (const scriptName of ['detect.sh', 'verify.sh']) {
    const scriptSrc = path.join(scriptsDir, scriptName);
    const scriptOut = path.join(scriptsDest, scriptName);
    let scriptContent = fs.readFileSync(scriptSrc, 'utf8');
    scriptContent = scriptContent.replace(/~\/\.claude\//g, pathPrefix);
    fs.writeFileSync(scriptOut, scriptContent);
    fs.chmodSync(scriptOut, 0o755);
    if (fs.existsSync(scriptOut)) {
      console.log(`  ${green}✓${reset} Installed infra/scripts/${scriptName}`);
      installedFiles.push({ rel: `infra/scripts/${scriptName}`, abs: scriptOut });
    } else {
      failures.push(`infra/scripts/${scriptName}`);
    }
  }

  // ── 6. infra/VERSION ──
  const versionDest = path.join(configDir, 'infra', 'VERSION');
  fs.writeFileSync(versionDest, pkg.version);
  if (fs.existsSync(versionDest)) {
    console.log(`  ${green}✓${reset} Wrote VERSION (${pkg.version})`);
    installedFiles.push({ rel: 'infra/VERSION', abs: versionDest });
  } else {
    failures.push('infra/VERSION');
  }

  // ── 7. hooks/infra-check-update.js (Claude Code only) ──
  let hookDest;
  if (!isOpencode) {
    const hookSrc = path.join(src, 'hooks', 'infra-check-update.js');
    hookDest = path.join(configDir, 'hooks', 'infra-check-update.js');
    fs.mkdirSync(path.dirname(hookDest), { recursive: true });
    fs.copyFileSync(hookSrc, hookDest);
    if (fs.existsSync(hookDest)) {
      console.log(`  ${green}✓${reset} Installed hooks/infra-check-update.js`);
      installedFiles.push({ rel: 'hooks/infra-check-update.js', abs: hookDest });
    } else {
      failures.push('hooks/infra-check-update.js');
    }
  }

  // Check for failures before proceeding
  if (failures.length > 0) {
    console.error(`\n  ${yellow}Installation incomplete!${reset} Failed: ${failures.join(', ')}`);
    process.exit(1);
  }

  // ── 7. Settings.json — additive hook merge (Claude Code only) ──
  if (!isOpencode) {
    const settingsPath = path.join(configDir, 'settings.json');
    const settings = readSettings(settingsPath);

    const updateCheckCommand = isGlobal
      ? buildHookCommand(configDir, 'infra-check-update.js')
      : 'node .claude/hooks/infra-check-update.js';

    // Ensure hooks structure exists
    if (!settings.hooks) {
      settings.hooks = {};
    }
    if (!settings.hooks.SessionStart) {
      settings.hooks.SessionStart = [];
    }

    // Only add our hook if not already present
    const hasOurHook = settings.hooks.SessionStart.some(entry =>
      entry.hooks && entry.hooks.some(h => h.command && h.command.includes('infra-check-update'))
    );

    if (!hasOurHook) {
      settings.hooks.SessionStart.push({
        hooks: [
          {
            type: 'command',
            command: updateCheckCommand,
          }
        ]
      });
      console.log(`  ${green}✓${reset} Added update check hook to settings.json`);
    } else {
      console.log(`  ${dim}─${reset} Update check hook already present`);
    }

    writeSettings(settingsPath, settings);
  }

  // ── 8. Write manifest ──
  const manifest = {
    version: pkg.version,
    timestamp: new Date().toISOString(),
    platform: isOpencode ? 'opencode' : 'claude-code',
    files: {},
  };

  for (const { rel, abs } of installedFiles) {
    manifest.files[rel] = fileHash(abs);
  }

  const manifestPath = path.join(configDir, MANIFEST_NAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`  ${green}✓${reset} Wrote file manifest (${MANIFEST_NAME})`);

  // Report any backed-up local patches
  reportLocalPatches(configDir);

  console.log(`
  ${green}Done!${reset} Launch ${isOpencode ? 'OpenCode' : 'Claude Code'} and run ${cyan}/infra-audit${reset}

  Other commands:
    ${cyan}/infra-fix${reset}             — Auto-fix audit findings using parallel agents
    ${cyan}/infra-status${reset}          — Check last audit/fix times and score
    ${cyan}/infra-update${reset}          — Update to the latest version
    ${cyan}/infra-update-versions${reset} — Refresh blueprint version baselines
`);
}

// ──────────────────────────────────────────────────────
// Uninstall
// ──────────────────────────────────────────────────────

function uninstall(isGlobal, isOpencode) {
  const configDir = getConfigDir(isGlobal, isOpencode);

  const locationLabel = isGlobal
    ? configDir.replace(os.homedir(), '~')
    : configDir.replace(process.cwd(), '.');

  console.log(`  Uninstalling from ${cyan}${locationLabel}${reset}\n`);

  if (!fs.existsSync(configDir)) {
    console.log(`  ${yellow}⚠${reset} Directory does not exist: ${locationLabel}`);
    console.log(`  Nothing to uninstall.\n`);
    return;
  }

  let removedCount = 0;

  // Remove our specific files (selective — don't touch other files)
  // Note: infra/history/ is NOT removed — it's user data, not ours
  const filesToRemove = [
    ...(isOpencode ? OUR_FILES_OPENCODE : OUR_FILES),
    ...(isOpencode ? LEGACY_FILES_OPENCODE : LEGACY_FILES_CLAUDE),
  ];

  for (const relPath of filesToRemove) {
    const fullPath = path.join(configDir, relPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      removedCount++;
      console.log(`  ${green}✓${reset} Removed ${relPath}`);
    }
  }

  // Clean up empty directories (only if we emptied them)
  const dirsToCheck = isOpencode
    ? [
        path.join(configDir, 'infra', 'blueprints'),
        path.join(configDir, 'infra', 'scripts'),
        path.join(configDir, 'infra'),
        // Skills directories (new layout)
        path.join(configDir, 'skills', 'infra-audit'),
        path.join(configDir, 'skills', 'infra-fix'),
        path.join(configDir, 'skills', 'infra-status'),
        path.join(configDir, 'skills', 'infra-update'),
        path.join(configDir, 'skills', 'infra-update-versions'),
      ]
    : [
        path.join(configDir, 'infra', 'blueprints'),
        path.join(configDir, 'infra', 'scripts'),
        path.join(configDir, 'infra'),
        // Skills directories (new layout)
        path.join(configDir, 'skills', 'infra-audit'),
        path.join(configDir, 'skills', 'infra-fix'),
        path.join(configDir, 'skills', 'infra-status'),
        path.join(configDir, 'skills', 'infra-update'),
        path.join(configDir, 'skills', 'infra-update-versions'),
        // Legacy commands directory (old layout)
        path.join(configDir, 'commands', 'infra'),
      ];

  for (const dir of dirsToCheck) {
    if (fs.existsSync(dir)) {
      const remaining = fs.readdirSync(dir);
      if (remaining.length === 0) {
        fs.rmdirSync(dir);
        console.log(`  ${green}✓${reset} Removed empty directory ${path.relative(configDir, dir)}`);
      } else {
        console.log(`  ${dim}─${reset} Kept ${path.relative(configDir, dir)}/ (contains other files)`);
      }
    }
  }

  // Remove our hook from settings.json (Claude Code only)
  if (!isOpencode) {
    const settingsPath = path.join(configDir, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = readSettings(settingsPath);
      let settingsModified = false;

      if (settings.hooks && settings.hooks.SessionStart) {
        const before = settings.hooks.SessionStart.length;
        settings.hooks.SessionStart = settings.hooks.SessionStart.filter(entry => {
          if (entry.hooks && Array.isArray(entry.hooks)) {
            const hasOurHook = entry.hooks.some(h =>
              h.command && h.command.includes('infra-check-update')
            );
            return !hasOurHook;
          }
          return true;
        });

        if (settings.hooks.SessionStart.length < before) {
          settingsModified = true;
          console.log(`  ${green}✓${reset} Removed hook from settings.json`);
        }

        // Clean up empty array
        if (settings.hooks.SessionStart.length === 0) {
          delete settings.hooks.SessionStart;
        }
        // Clean up empty hooks object
        if (settings.hooks && Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
      }

      if (settingsModified) {
        writeSettings(settingsPath, settings);
        removedCount++;
      }
    }
  }

  // Remove cache file
  const cacheFile = path.join(configDir, 'cache', 'infra-audit-update-check.json');
  if (fs.existsSync(cacheFile)) {
    fs.unlinkSync(cacheFile);
    removedCount++;
    console.log(`  ${green}✓${reset} Removed update cache`);
  }

  // Remove patches directory
  const patchesDir = path.join(configDir, PATCHES_DIR_NAME);
  if (fs.existsSync(patchesDir)) {
    fs.rmSync(patchesDir, { recursive: true });
    removedCount++;
    console.log(`  ${green}✓${reset} Removed local patches backup`);
  }

  const skillName = 'infra-audit';

  if (removedCount === 0) {
    console.log(`  ${yellow}⚠${reset} No ${skillName} files found to remove.`);
  }

  console.log(`
  ${green}Done!${reset} ${skillName} has been uninstalled.
  Your other files and settings have been preserved.
`);
}

// ──────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────

function installBoth(isGlobal) {
  console.log(`  ${yellow}Installing for both platforms...${reset}\n`);
  install(isGlobal, false);
  console.log(`  ${dim}─────────────────────────────────────${reset}\n`);
  install(isGlobal, true);
}

function uninstallBoth(isGlobal) {
  console.log(`  ${yellow}Uninstalling from both platforms...${reset}\n`);
  uninstall(isGlobal, false);
  console.log(`  ${dim}─────────────────────────────────────${reset}\n`);
  uninstall(isGlobal, true);
}

async function main() {
  // ── Step 1: Resolve platform ──
  let platform;
  if (hasBoth) {
    platform = 'both';
  } else if (hasClaude) {
    platform = 'claude';
  } else if (hasOpencode) {
    platform = 'opencode';
  } else {
    // No platform flag — ask (unless this is a help/uninstall-only shortcut)
    if (!hasUninstall || (!hasScopeFlag && !hasPlatformFlag)) {
      platform = await showPlatformMenu();
      if (platform === 'cancel') {
        console.log(`\n  ${dim}Cancelled.${reset}\n`);
        process.exit(0);
      }
    }
  }

  // ── Step 2: Resolve scope ──
  let isGlobal;
  if (hasGlobal) {
    isGlobal = true;
  } else if (hasLocal) {
    isGlobal = false;
  } else {
    const scope = await showScopeMenu(platform);
    if (scope === 'cancel') {
      console.log(`\n  ${dim}Cancelled.${reset}\n`);
      process.exit(0);
    }
    isGlobal = scope === 'global';
  }

  console.log('');

  // ── Execute ──
  if (hasUninstall) {
    if (platform === 'both') uninstallBoth(isGlobal);
    else uninstall(isGlobal, platform === 'opencode');
  } else {
    if (platform === 'both') installBoth(isGlobal);
    else install(isGlobal, platform === 'opencode');
  }
}

main();
