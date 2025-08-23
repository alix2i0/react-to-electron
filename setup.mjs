/**
 * setup.mjs
 * One-shot ESM script to electronize a Vite + React project.
 *
 * Usage:
 *   node setup.mjs --install      # auto-install devDependencies
 *   node setup.mjs                # just create files and patch config (no install)
 *
 * Notes:
 *  - Script is ESM (requires Node 18+).
 *  - It NEVER overwrites existing files without backing them up (package.json backup always created).
 *  - It writes src/electron/main.ts and src/electron/preload.ts as requested.
 */

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const ROOT = process.cwd();
const ARGV = new Set(process.argv.slice(2));
const DO_INSTALL = ARGV.has("--install");
const FORCE = ARGV.has("--force");

const log = (...a) => console.log("›", ...a);
const ok = (...a) => console.log("✅", ...a);
const warn = (...a) => console.warn("⚠", ...a);
const fail = (m) => { console.error("❌", m); process.exit(1); };

const exists = async (p) => {
  try { await fs.access(p); return true; } catch { return false; }
};

const ensureDir = async (p) => {
  if (!(await exists(p))) await fs.mkdir(p, { recursive: true });
};

const safeWrite = async (filePath, content, options = { force: false }) => {
  const p = path.resolve(filePath);
  if (await exists(p)) {
    if (!options.force) {
      // If file already exists and content identical -> skip
      const old = await fs.readFile(p, "utf8");
      if (old === content) {
        log(`Unchanged: ${filePath}`);
        return false;
      }
      // otherwise backup
      const bak = `${p}.bak-electronize`;
      await fs.copyFile(p, bak).catch(() => {});
      warn(`Backed up existing file to ${bak}`);
    }
  }
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, content, "utf8");
  log(`Wrote: ${filePath}`);
  return true;
};

const readJSON = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const writeJSON = async (p, obj) => safeWrite(p, JSON.stringify(obj, null, 2) + "\n", { force: true });

/* -------------------------
   Safety & environment checks
   ------------------------- */
const nodeVerOk = (() => {
  const v = process.versions.node.split(".").map(Number);
  return v[0] >= 18;
})();
if (!nodeVerOk) {
  warn("Node version < 18 detected. This script expects Node 18+. Continue at your own risk.");
}

/* -------------------------
   Paths
   ------------------------- */
const SRC = path.join(ROOT, "src");
const UI = path.join(SRC, "ui");
const ELECTRON_DIR = path.join(SRC, "electron");
const INDEX_HTML = path.join(ROOT, "index.html");
const PACKAGE_JSON = path.join(ROOT, "package.json");
const TSCONFIG_ELECTRON = path.join(ROOT, "tsconfig.electron.json");
const VITE_ELECTRON = path.join(ROOT, "vite.electron.config.ts");
const VITE_RENDERER = path.join(ROOT, "vite.renderer.config.ts");
const ELECTRON_BUILDER_YML = path.join(ROOT, "electron-builder.yml");

/* -------------------------
   Step 1: Move src -> src/ui (non-destructive)
   ------------------------- */
async function moveSrcToUi() {
  if (!(await exists(SRC))) fail("No src/ directory found. Run this in the React project root.");

  if (await exists(UI)) {
    log("src/ui already exists — skipping move.");
    return;
  }

  // If src/electron exists, only move non-electron files
  const items = await fs.readdir(SRC);
  // If only electron folder exists in src and nothing else, do nothing
  const hasNonElectron = items.some((name) => name !== "electron");
  if (!hasNonElectron) {
    log("src contains only electron/ (or is empty) — nothing to move.");
    return;
  }

  // Create ui dir
  await ensureDir(UI);

  for (const name of items) {
    if (name === "electron") continue;
    const from = path.join(SRC, name);
    const to = path.join(UI, name);
    try {
      await fs.rename(from, to);
    } catch (err) {
      // fallback copy & remove
      await fs.cp(from, to, { recursive: true });
      await fs.rm(from, { recursive: true, force: true });
    }
    log(`Moved ${path.join("src", name)} -> src/ui/${name}`);
  }
  ok("Moved src -> src/ui (non-electron files).");
}

/* -------------------------
   Step 2: Create src/electron main.ts & preload.ts
   ------------------------- */
const MAIN_TS_CONTENT = `import { app, BrowserWindow } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define paths for different build environments
const DIST_PATH = app.isPackaged
  ? path.join(__dirname, "../dist-react")
  : path.join(__dirname, "../../dist-react");

const PUBLIC_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "app", "public")
  : path.join(__dirname, "../../public");

// Set environment variables
process.env.DIST = DIST_PATH;
process.env.PUBLIC = PUBLIC_PATH;
process.env.VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "";
process.env.NODE_ENV = process.env.NODE_ENV || "production";

let win: BrowserWindow | null = null;
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  const iconPath = path.join(
    app.isPackaged ? PUBLIC_PATH : path.join(__dirname, "../../public"),
    process.platform === "win32" ? "favicon.ico" : "icon.png"
  );

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      devTools: !app.isPackaged,
    },
  });

  win.setMenuBarVisibility(false);
  try { win.setMenu(null); } catch { /* ignore */ }

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    const indexPath = path.join(DIST_PATH, "index.html");
    console.log("Loading index.html from:", indexPath);

    if (fs.existsSync(indexPath)) {
      win.loadFile(indexPath);
    } else {
      console.error("index.html not found at:", indexPath);
    }
  }
}

app.on("window-all-closed", () => {
  win = null;
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
`;

const PRELOAD_TS_CONTENT = `import { contextBridge, ipcRenderer } from "electron";

const electronAPI = {
  ipcRenderer: {
    send: (channel: string, data: any) => ipcRenderer.send(channel, data),
    on: (channel: string, func: (...args: any[]) => void) =>
      ipcRenderer.on(channel, (_event, ...args) => func(...args)),
    once: (channel: string, func: (...args: any[]) => void) =>
      ipcRenderer.once(channel, (_event, ...args) => func(...args)),
    removeListener: (channel: string, func: (...args: any[]) => void) =>
      ipcRenderer.removeListener(channel, func),
  },
};

contextBridge.exposeInMainWorld("electron", electronAPI);

ipcRenderer.on("main-process-message", (_event, message) => {
  console.log("[Receive Main-process message]:", message);
});

console.log("Preload script loaded!");
`;

/* -------------------------
   Step 3: Patch index.html to import /src/ui/<entry>
   ------------------------- */
const ENTRY_CANDIDATES = ["main.tsx","main.jsx","index.tsx","index.jsx","main.ts","index.ts","main.js","index.js"];

async function detectEntry() {
  for (const c of ENTRY_CANDIDATES) {
    const p = path.join(ROOT, "src", "ui", c);
    if (await exists(p)) return c;
  }
  // fallback
  return "main.tsx";
}

async function patchIndexHtml(entry) {
  const relScript = `<script type="module" src="/src/ui/${entry}"></script>`;
  if (!(await exists(INDEX_HTML))) {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <link rel="icon" href="/favicon.ico"/>
    <title>Electronized App</title>
  </head>
  <body>
    <div id="root"></div>
    ${relScript}
  </body>
</html>
`;
    await safeWrite(INDEX_HTML, html, { force: false });
    ok("Created index.html (points to /src/ui/" + entry + ")");
    return;
  }

  let html = await fs.readFile(INDEX_HTML, "utf8");
  // Replace existing module script if present
  const moduleTagRegex = /<script[^>]*type=["']module["'][^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/i;
  if (moduleTagRegex.test(html)) {
    html = html.replace(moduleTagRegex, relScript);
  } else if (!html.includes(relScript)) {
    html = html.replace("</body>", `  ${relScript}\n</body>`);
  } else {
    log("index.html already points to the detected entry -> skipping patch.");
  }
  await safeWrite(INDEX_HTML, html, { force: true });
  ok("Patched index.html to load /src/ui/" + entry);
}

/* -------------------------
   Step 4: Write tsconfig.electron.json, vite configs, electron-builder.yml
   ------------------------- */
const TSCONFIG_ELECTRON_CONTENT = {
  "extends": "./tsconfig.node.json",
  "compilerOptions": {
    "outDir": "src/electron",
    "lib": ["ES2022"],
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/electron/**/*.ts"],
  "exclude": ["node_modules", "dist-react", "src/electron/main.ts"]
};

const VITE_ELECTRON_CONTENT = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    electron([
      {
        entry: 'src/electron/main.ts',
        onstart(args) { args.reload(); },
        vite: {
          build: {
            sourcemap: true,
            minify: false,
            outDir: 'src/electron',
            rollupOptions: { external: ['electron'] },
          },
        },
      },
      {
        entry: 'src/electron/preload.ts',
        onstart(args) { args.reload(); },
        vite: {
          build: {
            sourcemap: 'inline',
            minify: false,
            outDir: 'src/electron',
            rollupOptions: { external: ['electron'] },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  optimizeDeps: { exclude: ['lucide-react'] },
  clearScreen: false,
});
`;

const VITE_RENDERER_CONTENT = `import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  optimizeDeps: { exclude: ['lucide-react'] },
  build: { outDir: 'dist-react' },
});
`;

const ELECTRON_BUILDER_YML_CONTENT = `appId: com.react.electron.app
productName: ElectronizedReactApp
directories:
  output: release
files:
  - dist-react/**/*
  - src/electron/**
  - public/**
win:
  target:
    - nsis
mac:
  target:
    - dmg
linux:
  target:
    - AppImage
`;

/* -------------------------
   Step 5: Patch package.json (backup first)
   ------------------------- */
const DESIRED_SCRIPTS = {
  "dev:react": "vite",
  "dev:electron": "electron .",
  "dev": "concurrently \"npm run dev:react\" \"npm run dev:electron\"",
  "lint": "eslint .",
  "preview": "vite preview",
  "build": "tsc -b && vite build",
  "electron:tsc": "tsc -p tsconfig.electron.json",
  "electron:dev": "cross-env NODE_ENV=development npm run electron:tsc && vite --config vite.electron.config.ts",
  "electron:build": "cross-env NODE_ENV=production npm run electron:tsc && vite build --config vite.renderer.config.ts",
  "build:electron": "npx electron-builder --config electron-builder.yml --dir",
  "package": "npx electron-builder --config electron-builder.yml"
};

const DESIRED_DEVDEPS = {
  "cross-env": "^10.0.0",
  "electron": "^32.1.2",
  "electron-builder": "^25.0.5",
  "vite": "^5.4.2",
  "vite-plugin-electron": "^0.29.0",
  "vite-plugin-electron-renderer": "^0.14.6",
  "concurrently": "^8.2.2",
  "wait-on": "^7.0.1",
  "typescript": "^5.2.0"
};

async function patchPackageJson() {
  if (!(await exists(PACKAGE_JSON))) fail("package.json not found.");
  const originalPkg = await fs.readFile(PACKAGE_JSON, "utf8");
  // backup original package.json
  await safeWrite(PACKAGE_JSON + ".bak-electronize", originalPkg, { force: true });

  const pkg = JSON.parse(originalPkg);

  // set type: module
  if (pkg.type && pkg.type !== "module") {
    warn(`Existing package.json 'type' is '${pkg.type}' — backing up and overriding with 'module'.`);
  }
  pkg.type = "module";
  // set main
  pkg.main = pkg.main || "src/electron/main";

  pkg.scripts = pkg.scripts || {};
  // add scripts (don't silently overwrite: if exists and differs, back it up under scripts._backup_<name>)
  for (const [k, v] of Object.entries(DESIRED_SCRIPTS)) {
    if (!pkg.scripts[k]) {
      pkg.scripts[k] = v;
    } else if (pkg.scripts[k] !== v) {
      const bakKey = `_backup_${k}`;
      if (!pkg.scripts[bakKey]) pkg.scripts[bakKey] = pkg.scripts[k];
      pkg.scripts[k] = v;
      warn(`script "${k}" existed and was saved to scripts.${bakKey} before updating.`);
    }
  }

  // merge devDependencies (do not overwrite existing versions)
  pkg.devDependencies = pkg.devDependencies || {};
  for (const [dep, ver] of Object.entries(DESIRED_DEVDEPS)) {
    if (!pkg.devDependencies[dep] && !(pkg.dependencies && pkg.dependencies[dep])) {
      pkg.devDependencies[dep] = ver;
    } else {
      // exists - keep existing
    }
  }

  await writeJSON(PACKAGE_JSON, pkg);
  ok("Updated package.json (backup at package.json.bak-electronize)");
}

/* -------------------------
   Step 6: Ensure public icons
   ------------------------- */
async function ensurePublicIcons() {
  const PUB = path.join(ROOT, "public");
  await ensureDir(PUB);
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
  const png = Buffer.from(pngBase64, "base64");
  const icoPath = path.join(PUB, "favicon.ico");
  const pngPath = path.join(PUB, "icon.png");
  if (!(await exists(icoPath))) await fs.writeFile(icoPath, png);
  if (!(await exists(pngPath))) await fs.writeFile(pngPath, png);
  ok("Ensured public/favicon.ico and public/icon.png");
}

/* -------------------------
   Step 7: Optionally run npm install
   ------------------------- */
async function runNpmInstall() {
  log("Running npm install to add devDependencies (this can take a few minutes)...");
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  await new Promise((resolve, reject) => {
    const p = spawn(npmCmd, ["install"], { stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("npm install failed"))));
  });
  ok("npm install finished");
}

/* -------------------------
   Execute
   ------------------------- */
(async () => {
  try {
    log("Starting electronize process (ESM mode) ...");

    // Move src to src/ui (respect --force)
    if (fsSync.existsSync(SRC)) {
      await moveSrcToUi();
    } else {
      warn("No src/ directory found — skipping move.");
    }

    // ensure electron dir
    await ensureDir(ELECTRON_DIR);

    // Write electron main + preload (no overwrite unless --force)
    await safeWrite(path.join(ELECTRON_DIR, "main.ts"), MAIN_TS_CONTENT, { force: FORCE });
    await safeWrite(path.join(ELECTRON_DIR, "preload.ts"), PRELOAD_TS_CONTENT, { force: FORCE });

    // Detect entry and patch index.html
    const entry = await detectEntry();
    await patchIndexHtml(entry);

    // Write tsconfig.electron.json
    await safeWrite(TSCONFIG_ELECTRON, JSON.stringify(TSCONFIG_ELECTRON_CONTENT, null, 2), { force: FORCE });

    // Write vite config files
    await safeWrite(VITE_ELECTRON, VITE_ELECTRON_CONTENT, { force: FORCE });
    await safeWrite(VITE_RENDERER, VITE_RENDERER_CONTENT, { force: FORCE });

    // electron-builder.yml
    await safeWrite(ELECTRON_BUILDER_YML, ELECTRON_BUILDER_YML_CONTENT, { force: FORCE });

    // patch package.json
    await patchPackageJson();

    // ensure public icons
    await ensurePublicIcons();

    // optionally install
    if (DO_INSTALL) {
      await runNpmInstall();
    } else {
      log("Skipped npm install. Run `npm install` manually or re-run with --install.");
    }

    ok("✅ Electronization complete!");
    console.log(`
Next steps:
  • Development (recommended):
      npm run dev
    (this runs Vite renderer and Electron together)

  • If Vite dev server uses a different port, set:
      cross-env VITE_DEV_SERVER_URL=http://localhost:5173 npm run dev

  • Production:
      npm run build
      npm run electron:build
      npm run package

  • If you want to revert package.json changes:
      cp package.json.bak-electronize package.json
`);
  } catch (e) {
    console.error("Fatal error:", e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
