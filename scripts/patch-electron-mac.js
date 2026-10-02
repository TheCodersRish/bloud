/**
 * Dev Electron.app ships without Bluetooth / Touch ID privacy strings.
 * WebAuthn (Amazon passkeys) needs them for Touch ID and phone passkeys over BLE.
 */
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

if (process.platform !== "darwin") {
  process.exit(0);
}

const root = path.join(__dirname, "..");
const electronApp = path.join(
  root,
  "node_modules",
  "electron",
  "dist",
  "Electron.app"
);
const infoPlist = path.join(electronApp, "Contents", "Info.plist");
const entitlements = path.join(root, "build", "entitlements.mac.plist");

const privacyStrings = {
  NSBluetoothAlwaysUsageDescription:
    "Bloud uses Bluetooth so you can sign in with passkeys and use wireless game controllers.",
  NSBluetoothPeripheralUsageDescription:
    "Bloud uses Bluetooth so you can sign in with passkeys and use wireless game controllers.",
  NSFaceIDUsageDescription:
    "Bloud uses Touch ID so you can sign in to Amazon with your passkey.",
};

function plistBuddy(args) {
  childProcess.execFileSync("/usr/libexec/PlistBuddy", args, { stdio: "pipe" });
}

function setPlistString(key, value) {
  if (!fs.existsSync(infoPlist)) return;
  const escaped = value.replace(/"/g, '\\"');
  try {
    plistBuddy(["-c", `Add :${key} string "${escaped}"`, infoPlist]);
  } catch {
    plistBuddy(["-c", `Set :${key} "${escaped}"`, infoPlist]);
  }
}

function patchInfoPlist() {
  if (!fs.existsSync(infoPlist)) {
    console.warn("patch-electron-mac: Electron.app not found, skipping plist patch");
    return;
  }
  for (const [key, value] of Object.entries(privacyStrings)) {
    setPlistString(key, value);
  }
}

function adhocSign() {
  if (!fs.existsSync(electronApp) || !fs.existsSync(entitlements)) return;

  const helperApps = [
    "Contents/Frameworks/Electron Helper.app",
    "Contents/Frameworks/Electron Helper (GPU).app",
    "Contents/Frameworks/Electron Helper (Plugin).app",
    "Contents/Frameworks/Electron Helper (Renderer).app",
  ];

  for (const rel of helperApps) {
    const helper = path.join(electronApp, rel);
    if (fs.existsSync(helper)) {
      childProcess.execFileSync(
        "codesign",
        ["--force", "--sign", "-", "--entitlements", entitlements, helper],
        { stdio: "pipe" }
      );
    }
  }

  childProcess.execFileSync(
    "codesign",
    ["--force", "--sign", "-", "--entitlements", entitlements, electronApp],
    { stdio: "pipe" }
  );
}

patchInfoPlist();
try {
  adhocSign();
} catch (err) {
  console.warn(
    "patch-electron-mac: codesign failed (passkeys may still work with Touch ID):",
    err.message
  );
}
