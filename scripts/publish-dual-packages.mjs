#!/usr/bin/env node
import { access as checkAccess, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const NEW_PACKAGE_NAME = "cc-flight";
const LEGACY_PACKAGE_NAME = "@seanxdo/superview";
const ENTRYPOINT = "runtime-node/cli-start.js";
const REQUIRED_PACKED_FILES = [ENTRYPOINT, "dist/ui/index.html"];

const options = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const parsed = {
    shouldPublish: false,
    skipBuild: false,
    skipLogin: false,
    access: "public",
    tag: "latest",
    otp: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--publish") {
      parsed.shouldPublish = true;
    } else if (arg === "--") {
      continue;
    } else if (arg === "--dry-run") {
      parsed.shouldPublish = false;
    } else if (arg === "--skip-build") {
      parsed.skipBuild = true;
    } else if (arg === "--skip-login") {
      parsed.skipLogin = true;
    } else if (arg === "--restricted") {
      parsed.access = "restricted";
    } else if (arg === "--tag") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--tag requires a value");
      }
      parsed.tag = value;
      index += 1;
    } else if (arg === "--otp") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--otp requires a value");
      }
      parsed.otp = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Publish cc-flight and the legacy @seanxdo/superview package.

Usage:
  pnpm publish:dual                 Dry-run both packages
  pnpm publish:dual:live            Publish both packages
  pnpm publish:dual -- --tag next    Dry-run with a custom dist-tag

Options:
  --publish       Publish to npm. Without this flag, the script runs local pack dry-runs.
  --dry-run       Force dry-run mode.
  --tag <tag>     npm dist-tag to use. Defaults to latest.
  --otp <code>    npm one-time password for accounts with 2FA enabled.
  --restricted    Publish with --access restricted. Defaults to public.
  --skip-build    Skip pnpm build before packing.
  --skip-login    Skip the npm whoami/login preflight.
`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed`);
  }
}

function runCapture(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    ...options,
  });
}

function ensureNpmLogin() {
  if (!options.shouldPublish || options.skipLogin) return;

  const whoami = runCapture("npm", ["whoami"]);
  if (whoami.status === 0) {
    console.log(`\n==> npm authenticated as ${whoami.stdout.trim()}`);
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("npm is not logged in. Run `npm login` first, or run this publish script from an interactive terminal.");
  }

  console.log("\n==> npm login required");
  run("npm", ["login"], { stdio: "inherit" });

  const afterLogin = runCapture("npm", ["whoami"]);
  if (afterLogin.status !== 0) {
    throw new Error("npm login did not complete successfully.");
  }
  console.log(`\n==> npm authenticated as ${afterLogin.stdout.trim()}`);
}

async function assertPackedFile(packageDir, relativePath) {
  try {
    await checkAccess(path.join(packageDir, relativePath));
  } catch {
    throw new Error(`Packed package is missing required file: ${relativePath}`);
  }
}

function removePublishLifecycleScripts(manifest) {
  if (!manifest.scripts) {
    return manifest;
  }

  const scripts = { ...manifest.scripts };
  delete scripts.prepublishOnly;
  delete scripts.prepack;
  delete scripts.prepare;
  delete scripts.postpack;
  manifest.scripts = scripts;
  return manifest;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function withPackedPackage(callback) {
  const packOutput = spawnSync("npm", ["pack", "--json", "--ignore-scripts"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (packOutput.status !== 0) {
    throw new Error("npm pack --json failed");
  }
  const [{ filename }] = JSON.parse(packOutput.stdout);
  const tempDir = await mkdtemp(path.join(tmpdir(), "cc-flight-publish-"));
  try {
    run("tar", ["-xzf", filename, "-C", tempDir]);
    await callback(path.join(tempDir, "package"));
  } finally {
    await rm(filename, { force: true });
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function publishPackage(packageDir, packageName) {
  if (!options.shouldPublish) {
    console.log(`\n==> npm pack --dry-run: ${packageName}`);
    run("npm", ["pack", "--dry-run", "--ignore-scripts"], { cwd: packageDir });
    return;
  }

  console.log(`\n==> npm publish: ${packageName}`);
  run(
    "npm",
    [
      "publish",
      "--access",
      options.access,
      "--tag",
      options.tag,
      options.otp ? "--otp" : null,
      options.otp,
    ].filter(Boolean),
    { cwd: packageDir },
  );
}

if (!options.skipBuild) {
  run("pnpm", ["build"]);
}

ensureNpmLogin();

await withPackedPackage(async (packageDir) => {
  const packageJsonPath = path.join(packageDir, "package.json");
  const manifest = await readJson(packageJsonPath);
  if (manifest.name !== NEW_PACKAGE_NAME) {
    throw new Error(`Expected package name ${NEW_PACKAGE_NAME}, found ${manifest.name}`);
  }

  for (const requiredFile of REQUIRED_PACKED_FILES) {
    await assertPackedFile(packageDir, requiredFile);
  }

  removePublishLifecycleScripts(manifest);
  await writeJson(packageJsonPath, manifest);
  await publishPackage(packageDir, NEW_PACKAGE_NAME);

  manifest.name = LEGACY_PACKAGE_NAME;
  manifest.description =
    "Compatibility package for cc-flight, the flight recorder for Claude Code and coding agents.";
  manifest.bin = {
    superview: ENTRYPOINT,
    "cc-flight": ENTRYPOINT,
    ccflight: ENTRYPOINT,
  };
  manifest.keywords = [
    "superview",
    "cc-flight",
    "claude-code",
    "codex",
    "ai-agent",
    "observability",
    "llm-tracing",
    "developer-tools",
  ];
  await writeJson(packageJsonPath, manifest);
  await publishPackage(packageDir, LEGACY_PACKAGE_NAME);
});

console.log(
  options.shouldPublish
    ? "\nPublished cc-flight and @seanxdo/superview."
    : "\nDry run complete. Re-run with --publish to publish both packages.",
);
