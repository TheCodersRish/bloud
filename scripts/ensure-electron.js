const { downloadArtifact } = require("@electron/get");
const extract = require("extract-zip");
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const electronDir = path.join(__dirname, "..", "node_modules", "electron");
const { version } = require(path.join(electronDir, "package.json"));

const pathFile = path.join(electronDir, "path.txt");

function platformRelativeBinary() {
  if (process.platform === "darwin") {
    return "Electron.app/Contents/MacOS/Electron";
  }
  if (process.platform === "win32") {
    return "electron.exe";
  }
  return "electron";
}

const frameworkBinary = path.join(
  electronDir,
  "dist",
  "Electron.app",
  "Contents",
  "Frameworks",
  "Electron Framework.framework",
  "Electron Framework"
);

function electronReady() {
  const binary = path.join(electronDir, "dist", platformRelativeBinary());
  if (!fs.existsSync(binary)) return false;
  if (process.platform === "darwin") {
    return fs.existsSync(frameworkBinary);
  }
  return true;
}

async function installElectron() {
  if (electronReady()) {
    fs.writeFileSync(pathFile, platformRelativeBinary());
    return;
  }

  fs.rmSync(path.join(electronDir, "dist"), { recursive: true, force: true });
  fs.rmSync(pathFile, { force: true });

  let arch = process.arch;
  if (process.platform === "darwin" && arch === "x64") {
    try {
      const rosetta = childProcess
        .execSync("sysctl -in sysctl.proc_translated")
        .toString()
        .trim();
      if (rosetta === "1") arch = "arm64";
    } catch {
      /* ignore */
    }
  }

  const zipPath = await downloadArtifact({
    version,
    artifactName: "electron",
    platform: process.platform,
    arch,
    checksums: require(path.join(electronDir, "checksums.json")),
  });

  await extract(zipPath, { dir: path.join(electronDir, "dist") });
  fs.writeFileSync(pathFile, platformRelativeBinary());

  if (!electronReady()) {
    const hint =
      process.platform === "darwin"
        ? "Delete ~/Library/Caches/electron and run npm install again."
        : "Delete ~/.cache/electron and run npm install again.";
    throw new Error(`Electron install looks incomplete. ${hint}`);
  }
}

installElectron().catch((err) => {
  console.error(err);
  process.exit(1);
});
