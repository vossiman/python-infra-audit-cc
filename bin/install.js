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
const hasUninstall = args.includes('--uninstall') || args.includes('-u');
const hasHelp = args.includes('--help') || args.includes('-h');

const banner = '\n' +
  cyan + '  ╔══════════════════════════════════════╗\n' +
  '  ║  Python Infra Audit for Claude Code  ║\n' +
  '  ╚══════════════════════════════════════╝' + reset + '\n' +
  '\n' +
  '  python-infra-audit-cc ' + dim + 'v' + pkg.version + reset + '\n';

console.log(banner);

// Show help if requested
if (hasHelp) {
  console.log(`  ${yellow}Usage:${reset} npx python-infra-audit-cc [options]\n
  ${yellow}Options:${reset}
    ${cyan}-g, --global${reset}      Install globally to ~/.claude/ (default)
    ${cyan}-l, --local${reset}       Install locally to ./.claude/ (this project only)
    ${cyan}-u, --uninstall${reset}   Remove all infra:audit files
    ${cyan}-h, --help${reset}        Show this help message

  ${yellow}Examples:${reset}
    ${dim}# Install globally (default)${reset}
    npx python-infra-audit-cc

    ${dim}# Install globally (explicit)${reset}
    npx python-infra-audit-cc --global

    ${dim}# Install to current project only${reset}
    npx python-infra-audit-cc --local

    ${dim}# Uninstall from global${reset}
    npx python-infra-audit-cc --global --uninstall

  ${yellow}After install:${reset}
    Launch Claude Code and run ${cyan}/infra:audit${reset}
`);
  process.exit(0);
}

// Validate args
if (hasGlobal && hasLocal) {
  console.error(`  ${yellow}Cannot specify both --global and --local${reset}`);
  process.exit(1);
}

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

/**
 * Get the config directory path
 */
function getConfigDir(isGlobal) {
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

// ──────────────────────────────────────────────────────
// Constants — files we own
// ──────────────────────────────────────────────────────

const MANIFEST_NAME = 'infra-audit-manifest.json';
const PATCHES_DIR_NAME = 'infra-audit-local-patches';

// Files we install (relative to config dir)
const OUR_FILES = [
  'commands/infra/audit.md',
  'commands/infra/update.md',
  'infra/blueprint.md',
  'infra/VERSION',
  'hooks/infra-check-update.js',
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

function install(isGlobal) {
  const src = path.join(__dirname, '..');
  const configDir = getConfigDir(isGlobal);

  const locationLabel = isGlobal
    ? configDir.replace(os.homedir(), '~')
    : configDir.replace(process.cwd(), '.');

  // Path prefix for file references in markdown content
  const pathPrefix = isGlobal
    ? `${configDir.replace(/\\/g, '/')}/`
    : './.claude/';

  console.log(`  Installing to ${cyan}${locationLabel}${reset}\n`);

  // Save any locally modified files before overwriting
  saveLocalPatches(configDir);

  // Track failures
  const failures = [];

  // ── 1. commands/infra/audit.md ──
  const auditSrc = path.join(src, 'commands', 'infra', 'audit.md');
  const auditDest = path.join(configDir, 'commands', 'infra', 'audit.md');
  fs.mkdirSync(path.dirname(auditDest), { recursive: true });
  let auditContent = fs.readFileSync(auditSrc, 'utf8');
  // Path template: replace ~/.claude/ with the actual install path
  auditContent = auditContent.replace(/~\/\.claude\//g, pathPrefix);
  fs.writeFileSync(auditDest, auditContent);
  if (fs.existsSync(auditDest)) {
    console.log(`  ${green}✓${reset} Installed commands/infra/audit.md`);
  } else {
    failures.push('commands/infra/audit.md');
  }

  // ── 2. commands/infra/update.md ──
  const updateSrc = path.join(src, 'commands', 'infra', 'update.md');
  const updateDest = path.join(configDir, 'commands', 'infra', 'update.md');
  let updateContent = fs.readFileSync(updateSrc, 'utf8');
  updateContent = updateContent.replace(/~\/\.claude\//g, pathPrefix);
  fs.writeFileSync(updateDest, updateContent);
  if (fs.existsSync(updateDest)) {
    console.log(`  ${green}✓${reset} Installed commands/infra/update.md`);
  } else {
    failures.push('commands/infra/update.md');
  }

  // ── 3. infra/blueprint.md ──
  const blueprintSrc = path.join(src, 'infra', 'blueprint.md');
  const blueprintDest = path.join(configDir, 'infra', 'blueprint.md');
  fs.mkdirSync(path.dirname(blueprintDest), { recursive: true });
  fs.copyFileSync(blueprintSrc, blueprintDest);
  if (fs.existsSync(blueprintDest)) {
    console.log(`  ${green}✓${reset} Installed infra/blueprint.md`);
  } else {
    failures.push('infra/blueprint.md');
  }

  // ── 4. infra/VERSION ──
  const versionDest = path.join(configDir, 'infra', 'VERSION');
  fs.writeFileSync(versionDest, pkg.version);
  if (fs.existsSync(versionDest)) {
    console.log(`  ${green}✓${reset} Wrote VERSION (${pkg.version})`);
  } else {
    failures.push('infra/VERSION');
  }

  // ── 5. hooks/infra-check-update.js ──
  const hookSrc = path.join(src, 'hooks', 'infra-check-update.js');
  const hookDest = path.join(configDir, 'hooks', 'infra-check-update.js');
  fs.mkdirSync(path.dirname(hookDest), { recursive: true });
  fs.copyFileSync(hookSrc, hookDest);
  if (fs.existsSync(hookDest)) {
    console.log(`  ${green}✓${reset} Installed hooks/infra-check-update.js`);
  } else {
    failures.push('hooks/infra-check-update.js');
  }

  // Check for failures before proceeding
  if (failures.length > 0) {
    console.error(`\n  ${yellow}Installation incomplete!${reset} Failed: ${failures.join(', ')}`);
    process.exit(1);
  }

  // ── 6. Settings.json — additive hook merge ──
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

  // ── 7. Write manifest ──
  const manifest = {
    version: pkg.version,
    timestamp: new Date().toISOString(),
    files: {},
  };

  // Hash all installed files
  const installedFiles = [
    { rel: 'commands/infra/audit.md', abs: auditDest },
    { rel: 'commands/infra/update.md', abs: updateDest },
    { rel: 'infra/blueprint.md', abs: blueprintDest },
    { rel: 'infra/VERSION', abs: versionDest },
    { rel: 'hooks/infra-check-update.js', abs: hookDest },
  ];

  for (const { rel, abs } of installedFiles) {
    manifest.files[rel] = fileHash(abs);
  }

  const manifestPath = path.join(configDir, MANIFEST_NAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`  ${green}✓${reset} Wrote file manifest (${MANIFEST_NAME})`);

  // Report any backed-up local patches
  reportLocalPatches(configDir);

  console.log(`
  ${green}Done!${reset} Launch Claude Code and run ${cyan}/infra:audit${reset}

  Other commands:
    ${cyan}/infra:update${reset}  — Update to the latest version
`);
}

// ──────────────────────────────────────────────────────
// Uninstall
// ──────────────────────────────────────────────────────

function uninstall(isGlobal) {
  const configDir = getConfigDir(isGlobal);

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

  // Remove our specific files (selective — don't touch other files in commands/infra/)
  const filesToRemove = [
    'commands/infra/audit.md',
    'commands/infra/update.md',
    'infra/blueprint.md',
    'infra/VERSION',
    'hooks/infra-check-update.js',
    MANIFEST_NAME,
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
  const dirsToCheck = [
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

  // Remove our hook from settings.json
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

  if (removedCount === 0) {
    console.log(`  ${yellow}⚠${reset} No infra:audit files found to remove.`);
  }

  console.log(`
  ${green}Done!${reset} infra:audit has been uninstalled.
  Your other files and settings have been preserved.
`);
}

// ──────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────

if (hasUninstall) {
  if (!hasGlobal && !hasLocal) {
    console.error(`  ${yellow}--uninstall requires --global or --local${reset}`);
    process.exit(1);
  }
  uninstall(hasGlobal);
} else if (hasGlobal || hasLocal) {
  install(hasGlobal);
} else {
  // Default to global
  install(true);
}
