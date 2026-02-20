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
const platformLabel = hasBoth ? 'Both' : hasOpencode ? 'OpenCode' : 'Claude Code';

function printBanner(label) {
  const padded = (label || platformLabel).padEnd(13);
  const banner = '\n' +
    cyan + '  ╔══════════════════════════════════════╗\n' +
    '  ║  Python Infra Audit for ' + padded + '║\n' +
    '  ╚══════════════════════════════════════╝' + reset + '\n' +
    '\n' +
    '  python-infra-audit-cc ' + dim + 'v' + pkg.version + reset + '\n';
  console.log(banner);
}

// Print banner immediately only if platform is already known
if (hasPlatformFlag || hasHelp || hasUninstall) {
  printBanner();
}

// Show help if requested
if (hasHelp) {
  console.log(`  ${yellow}Usage:${reset} npx python-infra-audit-cc [options]\n
  ${yellow}Platform:${reset}
    ${cyan}-c, --claude${reset}      Install for Claude Code
    ${cyan}-o, --opencode${reset}    Install for OpenCode
    ${cyan}-b, --both${reset}        Install for both Claude Code and OpenCode
    ${dim}(no flag)${reset}         Interactive menu to choose platform

  ${yellow}Options:${reset}
    ${cyan}-g, --global${reset}      Install globally (default)
    ${cyan}-l, --local${reset}       Install locally to current project only
    ${cyan}-u, --uninstall${reset}   Remove all infra-audit files
    ${cyan}-h, --help${reset}        Show this help message

  ${yellow}Claude Code examples:${reset}
    ${dim}# Install globally${reset}
    npx python-infra-audit-cc --claude

    ${dim}# Install to current project only${reset}
    npx python-infra-audit-cc --claude --local

    ${dim}# Uninstall from global${reset}
    npx python-infra-audit-cc --claude --uninstall

  ${yellow}OpenCode examples:${reset}
    ${dim}# Install globally for OpenCode${reset}
    npx python-infra-audit-cc --opencode

    ${dim}# Install to current project only${reset}
    npx python-infra-audit-cc --opencode --local

    ${dim}# Uninstall from OpenCode${reset}
    npx python-infra-audit-cc --opencode --uninstall

  ${yellow}Both platforms:${reset}
    ${dim}# Install for both${reset}
    npx python-infra-audit-cc --both

    ${dim}# Uninstall from both${reset}
    npx python-infra-audit-cc --both --uninstall

  ${yellow}After install:${reset}
    Claude Code: run ${cyan}/infra:audit${reset}
    OpenCode:    run ${cyan}/infra-audit${reset}
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
// Interactive platform menu
// ──────────────────────────────────────────────────────

function showPlatformMenu() {
  return new Promise((resolve) => {
    const readline = require('readline');

    // Show a generic banner for the menu
    printBanner('AI Coding IDE');

    console.log(`  ${yellow}Choose platform:${reset}\n`);
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
 * Transform command markdown content for OpenCode.
 * - Rewrite frontmatter: keep only description
 * - Replace /infra:X → /infra-X (slash command references)
 * - Replace `infra:X` → `infra-X` (backtick-quoted references)
 */
function transformForOpencode(content) {
  // 1. Rewrite frontmatter: keep only description
  content = content.replace(/^---\n([\s\S]*?)\n---/, (match, fm) => {
    const descMatch = fm.match(/^description:\s*(.+)$/m);
    if (descMatch) {
      return `---\ndescription: ${descMatch[1]}\n---`;
    }
    return '---\n---';
  });

  // 2. Replace infra:audit/fix/status/update → infra-audit/fix/status/update
  //    Covers all contexts: /infra:audit, `infra:audit`, plain text "infra:audit"
  content = content.replace(/infra:(audit|fix|status|update)/g, 'infra-$1');

  return content;
}

// ──────────────────────────────────────────────────────
// Constants — files we own
// ──────────────────────────────────────────────────────

const MANIFEST_NAME = 'infra-audit-manifest.json';
const PATCHES_DIR_NAME = 'infra-audit-local-patches';

// Command names (source files live at commands/infra/{name}.md)
const COMMAND_NAMES = ['audit', 'fix', 'status', 'update'];

// Files we install (relative to config dir) — Claude Code layout
const OUR_FILES = [
  'commands/infra/audit.md',
  'commands/infra/fix.md',
  'commands/infra/status.md',
  'commands/infra/update.md',
  'infra/blueprint.md',
  'infra/blueprints/ci.yml',
  'infra/blueprints/renovate.yml',
  'infra/scripts/detect.sh',
  'infra/scripts/verify.sh',
  'infra/VERSION',
  'hooks/infra-check-update.js',
  MANIFEST_NAME,
];

// Files we install (relative to config dir) — OpenCode layout (flat commands, no hooks)
const OUR_FILES_OPENCODE = [
  'commands/infra-audit.md',
  'commands/infra-fix.md',
  'commands/infra-status.md',
  'commands/infra-update.md',
  'infra/blueprint.md',
  'infra/blueprints/ci.yml',
  'infra/blueprints/renovate.yml',
  'infra/scripts/detect.sh',
  'infra/scripts/verify.sh',
  'infra/VERSION',
  MANIFEST_NAME,
];

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

  // Track failures
  const failures = [];

  // Track installed files for manifest
  const installedFiles = [];

  // ── 1. Command files ──
  for (const name of COMMAND_NAMES) {
    const cmdSrc = path.join(src, 'commands', 'infra', `${name}.md`);

    // OpenCode: flat commands/infra-{name}.md; Claude Code: commands/infra/{name}.md
    const destRelPath = isOpencode
      ? `commands/infra-${name}.md`
      : `commands/infra/${name}.md`;
    const destFull = path.join(configDir, destRelPath);

    fs.mkdirSync(path.dirname(destFull), { recursive: true });

    let content = fs.readFileSync(cmdSrc, 'utf8');
    // Path template: replace ~/.claude/ with the actual install path
    content = content.replace(/~\/\.claude\//g, pathPrefix);

    if (isOpencode) {
      // Replace $HOME/.claude/ with OpenCode path for bash runtime references
      content = content.replace(/\$HOME\/\.claude\//g, '$HOME/.config/opencode/');
      // Replace ./.claude/ with ./.opencode/ for local project references
      content = content.replace(/\.\/\.claude\//g, './.opencode/');
      // Transform frontmatter and command references
      content = transformForOpencode(content);
      // update.md: rewrite installer flags for OpenCode
      if (name === 'update') {
        content = content.replace(/--global/g, '--opencode');
        content = content.replace(/--local/g, '--opencode --local');
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

  // ── 4. infra/scripts/*.sh ──
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

  // ── 5. infra/VERSION ──
  const versionDest = path.join(configDir, 'infra', 'VERSION');
  fs.writeFileSync(versionDest, pkg.version);
  if (fs.existsSync(versionDest)) {
    console.log(`  ${green}✓${reset} Wrote VERSION (${pkg.version})`);
    installedFiles.push({ rel: 'infra/VERSION', abs: versionDest });
  } else {
    failures.push('infra/VERSION');
  }

  // ── 6. hooks/infra-check-update.js (Claude Code only) ──
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

  if (isOpencode) {
    console.log(`
  ${green}Done!${reset} Launch OpenCode and run ${cyan}/infra-audit${reset}

  Other commands:
    ${cyan}/infra-fix${reset}     — Auto-fix audit findings using parallel agents
    ${cyan}/infra-status${reset}  — Check last audit/fix times and score
    ${cyan}/infra-update${reset}  — Update to the latest version
`);
  } else {
    console.log(`
  ${green}Done!${reset} Launch Claude Code and run ${cyan}/infra:audit${reset}

  Other commands:
    ${cyan}/infra:fix${reset}     — Auto-fix audit findings using parallel agents
    ${cyan}/infra:status${reset}  — Check last audit/fix times and score
    ${cyan}/infra:update${reset}  — Update to the latest version
`);
  }
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
  const filesToRemove = isOpencode ? OUR_FILES_OPENCODE : OUR_FILES;

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
      ]
    : [
        path.join(configDir, 'infra', 'blueprints'),
        path.join(configDir, 'infra', 'scripts'),
        path.join(configDir, 'infra'),
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

  const skillName = isOpencode ? 'infra-audit' : 'infra:audit';

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
  const isGlobal = !hasLocal;

  if (hasUninstall) {
    if (hasBoth) {
      uninstallBoth(isGlobal);
    } else if (hasPlatformFlag || hasGlobal || hasLocal) {
      uninstall(isGlobal, hasOpencode);
    } else {
      // No platform flag — show menu for uninstall too
      const choice = await showPlatformMenu();
      if (choice === 'cancel') {
        console.log(`\n  ${dim}Cancelled.${reset}\n`);
        process.exit(0);
      }
      console.log('');
      if (choice === 'both') uninstallBoth(isGlobal);
      else uninstall(isGlobal, choice === 'opencode');
    }
  } else if (hasBoth) {
    installBoth(isGlobal);
  } else if (hasPlatformFlag || hasGlobal || hasLocal) {
    install(isGlobal, hasOpencode);
  } else {
    // No flags at all — interactive menu
    const choice = await showPlatformMenu();
    if (choice === 'cancel') {
      console.log(`\n  ${dim}Cancelled.${reset}\n`);
      process.exit(0);
    }
    console.log('');
    if (choice === 'both') installBoth(isGlobal);
    else install(isGlobal, choice === 'opencode');
  }
}

main();
