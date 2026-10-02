const {
  app,
  BrowserWindow,
  Menu,
  shell,
  session,
  dialog,
  screen,
} = require("electron");
const fs = require("fs");
const path = require("path");
const {
  isAmazonHost,
  configureAmazonSession,
  attachChromeIdentityToWebContents,
  attachLunaPermissionsToWebContents,
} = require("./session-setup");
const { startBrowserPasskeySignIn, closeActiveAuth } = require("./browser-auth");

const LUNA_HOME = "https://luna.amazon.com/";
/** Full-page Amazon sign-in (passkeys do not appear in Luna’s small OAuth popups). */
const AMAZON_SIGN_IN =
  "https://www.amazon.com/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fluna.amazon.com%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_luna_desktop_us&openid.mode=checkid_setup&language=en_US&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0";
const PARTITION = "persist:bloud-luna";

const WEBAUTHN_FEATURES = [
  "WebBluetooth",
  "WebHID",
  "GamepadMultidevice",
  "WebAuthentication",
  "WebAuthenticationConditionalUI",
  "WebAuthnNewPasskeyUI",
  "WebAuthnMacOSEnclavePasskeys",
].join(",");

const CHROME_FULL = process.versions.chrome;
let USER_AGENT = "";
let identityScript = "";
let lunaPermissionsScript = "";
const lunaGameActionsScript = fs.readFileSync(
  path.join(__dirname, "luna-game-actions.js"),
  "utf8"
);

let mainWindow;
/** @type {import("electron").BrowserWindow | null} */
let artWindow = null;
let gameArtSessionActive = false;
let artRefreshTimer = null;

const M_EXIT_PRESS_COUNT = 4;
const M_EXIT_WINDOW_MS = 2200;
/** @type {number[]} */
let recentMPressTimes = [];

app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled");

function baseWebPreferences() {
  return {
    partition: PARTITION,
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webgl: true,
    backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required",
  };
}

function loadInMainWindow(url) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.focus();
  mainWindow.loadURL(url, { userAgent: USER_AGENT });
}

function getInternalDisplay() {
  return screen.getAllDisplays().find((d) => d.internal);
}

function getExternalDisplay() {
  const displays = screen.getAllDisplays();
  const external = displays.filter((d) => !d.internal);
  if (external.length === 0) return screen.getPrimaryDisplay();
  return external.reduce((a, b) =>
    b.size.width * b.size.height > a.size.width * a.size.height ? b : a
  );
}

function destroyArtWindow() {
  if (artRefreshTimer) {
    clearInterval(artRefreshTimer);
    artRefreshTimer = null;
  }
  if (artWindow && !artWindow.isDestroyed()) {
    artWindow.close();
  }
  artWindow = null;
  gameArtSessionActive = false;
}

async function injectLunaGameActions(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  const frames = webContents.mainFrame?.framesInSubtree || [webContents.mainFrame];
  for (const frame of frames) {
    if (!frame || frame.isDestroyed()) continue;
    try {
      await frame.executeJavaScript(lunaGameActionsScript, true);
    } catch {
      /* cross-origin iframes */
    }
  }
}

async function refreshGameArtDisplay() {
  if (!mainWindow || mainWindow.isDestroyed() || !gameArtSessionActive) return;

  await injectLunaGameActions(mainWindow.webContents);

  const meta = await (async () => {
    const frames = mainWindow.webContents.mainFrame?.framesInSubtree || [
      mainWindow.webContents.mainFrame,
    ];
    for (const frame of frames) {
      if (!frame || frame.isDestroyed()) continue;
      try {
        const data = await frame.executeJavaScript(
          `(function () {
            if (typeof __bloudExtractGameArt !== "function") return null;
            return __bloudExtractGameArt();
          })()`,
          true
        );
        if (data && data.imageUrl) return data;
      } catch {
        /* cross-origin */
      }
    }
    return null;
  })();

  if (!meta || !meta.imageUrl) return;

  if (!artWindow || artWindow.isDestroyed()) {
    const internal = getInternalDisplay();
    const displays = screen.getAllDisplays();
    if (!internal || displays.length < 2) return;

    const { x, y, width, height } = internal.bounds;
    artWindow = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      fullscreen: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: "#050508",
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    artWindow.setAlwaysOnTop(false, "normal");
    await artWindow.loadFile(path.join(__dirname, "game-art.html"));
    artWindow.showInactive();
  }

  const payload = JSON.stringify(meta.imageUrl);
  const title = JSON.stringify(meta.title || "Now playing");
  await artWindow.webContents.executeJavaScript(
    `window.updateArt && window.updateArt(${payload}, ${title})`
  );
}

async function syncGameArtLayout(inGame) {
  if (process.platform !== "darwin") return;

  const internal = getInternalDisplay();
  const displays = screen.getAllDisplays();
  if (!internal || displays.length < 2 || !mainWindow || mainWindow.isDestroyed()) {
    if (!inGame) destroyArtWindow();
    return;
  }

  if (inGame) {
    gameArtSessionActive = true;
    const external = getExternalDisplay();
    const area = external.workArea || external.bounds;
    mainWindow.setBounds({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
    });
    mainWindow.setFullScreen(true);
    await refreshGameArtDisplay();
    if (!artRefreshTimer) {
      artRefreshTimer = setInterval(() => {
        refreshGameArtDisplay().catch(() => {});
      }, 15000);
    }
    return;
  }

  destroyArtWindow();
}

async function detectInGameSession() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  await injectLunaGameActions(mainWindow.webContents);
  const frames = mainWindow.webContents.mainFrame?.framesInSubtree || [
    mainWindow.webContents.mainFrame,
  ];
  for (const frame of frames) {
    if (!frame || frame.isDestroyed()) continue;
    try {
      const inGame = await frame.executeJavaScript(
        `(function () {
          return typeof __bloudLooksLikeInGame === "function" && __bloudLooksLikeInGame();
        })()`,
        true
      );
      if (inGame) return true;
    } catch {
      /* cross-origin */
    }
  }
  return false;
}

async function updateGameArtFromPage() {
  const inGame = await detectInGameSession().catch(() => false);
  await syncGameArtLayout(inGame);
}

async function exitLunaGame() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  destroyArtWindow();
  await injectLunaGameActions(mainWindow.webContents);
  await mainWindow.webContents
    .executeJavaScript(`window.__bloudExitLunaGame && window.__bloudExitLunaGame()`, true)
    .catch(() => {});

  setTimeout(() => {
    loadInMainWindow(LUNA_HOME);
  }, 600);
}

function attachQuadMExitShortcut(webContents) {
  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key?.toLowerCase() !== "m") return;
    if (input.meta || input.control || input.alt) return;

    const now = Date.now();
    recentMPressTimes = recentMPressTimes.filter((t) => now - t < M_EXIT_WINDOW_MS);
    recentMPressTimes.push(now);

    if (recentMPressTimes.length < M_EXIT_PRESS_COUNT) return;

    recentMPressTimes = [];
    event.preventDefault();
    exitLunaGame().catch(() => {});
  });
}

async function signInViaBrowser(signInUrl = AMAZON_SIGN_IN) {
  const ses = session.fromPartition(PARTITION);
  try {
    const result = await startBrowserPasskeySignIn({
      signInUrl,
      electronSession: ses,
      parentWindow: mainWindow,
    });

    if (result.ok) {
      loadInMainWindow(LUNA_HOME);
      return;
    }

    if (result.reason === "no-cookies") {
      dialog.showMessageBox(mainWindow, {
        type: "warning",
        buttons: ["OK"],
        title: "Not signed in yet",
        message: "Could not copy an Amazon session.",
        detail:
          "Finish signing in with your passkey in the browser, then use Luna → Sign in with browser (passkey) again and click “Sync session to Bloud”.",
      });
    }
  } catch (err) {
    dialog.showErrorBox("Browser sign-in failed", err.message);
  }
}

function isAmazonAuthUrl(url) {
  try {
    return isAmazonHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isAmazonOrigin(origin) {
  try {
    return isAmazonHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function registerWebContents(contents) {
  contents.setUserAgent(USER_AGENT);
  attachChromeIdentityToWebContents(contents, identityScript);
  attachLunaPermissionsToWebContents(contents, lunaPermissionsScript);

  if (contents === mainWindow?.webContents) {
    attachQuadMExitShortcut(contents);
  }

  contents.on("dom-ready", () => {
    if (contents === mainWindow?.webContents) {
      updateGameArtFromPage().catch(() => {});
    }
  });
  contents.on("did-navigate-in-page", () => {
    if (contents === mainWindow?.webContents) {
      updateGameArtFromPage().catch(() => {});
    }
  });
  contents.on("did-navigate", () => {
    if (contents === mainWindow?.webContents) {
      updateGameArtFromPage().catch(() => {});
    }
  });

  contents.on("enter-html-full-screen", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(true);
    }
    if (contents === mainWindow?.webContents) {
      syncGameArtLayout(true).catch(() => {});
    }
  });
  contents.on("leave-html-full-screen", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(false);
    }
    updateGameArtFromPage().catch(() => {});
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (isAmazonAuthUrl(url)) {
      signInViaBrowser(url);
      return { action: "deny" };
    }
    if (url.startsWith(LUNA_HOME)) {
      loadInMainWindow(url);
      return { action: "deny" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    title: "Bloud — Amazon Luna (browser passkey sign-in)",
    backgroundColor: "#0a0a0a",
    show: false,
    webPreferences: baseWebPreferences(),
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.loadURL(LUNA_HOME, { userAgent: USER_AGENT });

  mainWindow.on("closed", () => {
    destroyArtWindow();
    mainWindow = null;
  });
}

function reloadLuna() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reload();
  }
}

async function clearSessionAndRestart() {
  const ses = session.fromPartition(PARTITION);
  await ses.clearStorageData();
  await ses.clearCache();
  loadInMainWindow(LUNA_HOME);
}

async function showControllerStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const report = await mainWindow.webContents.executeJavaScript(`
    (function () {
      const pads = navigator.getGamepads
        ? [...navigator.getGamepads()].filter(Boolean)
        : [];
      if (pads.length === 0) {
        const plat = ${JSON.stringify(process.platform)};
        const pairHint = plat === "darwin"
          ? "Pair your controller in System Settings → Bluetooth before opening a game."
          : "Pair your controller in KDE Settings → Bluetooth (or plug in USB) before opening a game.";
        return "No controllers detected yet.\\n\\n• " + pairHint + "\\n• Xbox / PlayStation / Luna Controller are supported.\\n• Press any button on the controller, then try again.\\n• Luna Controller: use USB-C or Bluetooth.";
      }
      return pads
        .map((p, i) => (i + 1) + ". " + p.id + " (" + p.buttons.length + " buttons)")
        .join("\\n");
    })()
  `);

  dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Controllers",
    message: "Gamepad status",
    detail: report,
  });
}

async function showPasskeyDiagnostics() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const report = await mainWindow.webContents.executeJavaScript(`
    (function () {
      const lines = [];
      lines.push("URL: " + location.href);
      lines.push("userAgent: " + navigator.userAgent);
      lines.push("PublicKeyCredential: " + (window.PublicKeyCredential ? "yes" : "no"));
      if (window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
        return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
          .then((uvpa) => {
            lines.push("Platform authenticator (Touch ID): " + (uvpa ? "available" : "not available"));
            return lines.join("\\n");
          })
          .catch((e) => lines.join("\\n") + "\\n" + e.message);
      }
      return lines.join("\\n");
    })()
  `);

  dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Passkey diagnostics",
    message: "Current page",
    detail: report,
  });
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Luna",
      submenu: [
        {
          label: "Home",
          accelerator: "CmdOrCtrl+Shift+H",
          click: () => loadInMainWindow(LUNA_HOME),
        },
        {
          label: "Sign in with browser (passkey)",
          accelerator: "CmdOrCtrl+Shift+L",
          click: () => signInViaBrowser(AMAZON_SIGN_IN),
        },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: reloadLuna },
        {
          label: "Clear cache & sign-in data",
          click: async () => {
            const { response } = await dialog.showMessageBox(mainWindow, {
              type: "warning",
              buttons: ["Cancel", "Clear and restart"],
              defaultId: 0,
              cancelId: 0,
              message: "Clear Bloud session data?",
              detail:
                "Use this if games fail to launch or Luna shows a stale session. You will need to sign in to Amazon again.",
            });
            if (response === 1) await clearSessionAndRestart();
          },
        },
        { type: "separator" },
        {
          label: "Check controllers",
          accelerator: "CmdOrCtrl+G",
          click: showControllerStatus,
        },
        {
          label: "Passkey diagnostics",
          click: showPasskeyDiagnostics,
        },
        {
          label: "Show game art on built-in display",
          click: () => {
            syncGameArtLayout(true).catch(() => {});
          },
        },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Luna controller compatibility",
          click: () => {
            shell.openExternal(
              "https://www.amazon.com/gp/help/customer/display.html?nodeId=GYNLANRYMK4WTXSS"
            );
          },
        },
        {
          label: "Luna Controller app (Cloud Direct)",
          click: () => {
            shell.openExternal("https://apps.apple.com/us/app/luna-controller/id1528364633");
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const SESSION_PERMISSIONS = new Set([
  "media",
  "geolocation",
  "notifications",
  "fullscreen",
  "pointerLock",
  "keyboardLock",
  "openExternal",
  "clipboard-read",
  "clipboard-sanitized-write",
  "storage-access",
  "top-level-storage-access",
  "window-management",
]);

function isLunaGameplayOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return hostname === "luna.amazon.com" || isAmazonHost(hostname);
  } catch {
    return false;
  }
}

function allowPermission(origin, permission) {
  if (isLunaGameplayOrigin(origin)) {
    return (
      SESSION_PERMISSIONS.has(permission) ||
      permission === "unknown" ||
      permission === "openExternal"
    );
  }
  if (isAmazonOrigin(origin) && (permission === "unknown" || permission === "openExternal")) {
    return true;
  }
  return SESSION_PERMISSIONS.has(permission);
}

function configureSession() {
  const ses = session.fromPartition(PARTITION);
  const amazon = configureAmazonSession(ses, CHROME_FULL);
  USER_AGENT = amazon.userAgent;
  identityScript = amazon.identityScript;
  lunaPermissionsScript = amazon.lunaPermissionsScript;
  app.userAgentFallback = USER_AGENT;

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin =
      details.requestingUrl || (webContents && webContents.getURL()) || "";
    callback(allowPermission(origin, permission));
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return allowPermission(requestingOrigin, permission);
  });
}

app.whenReady().then(() => {
  app.commandLine.appendSwitch("enable-features", WEBAUTHN_FEATURES);

  configureSession();

  app.on("web-contents-created", (_event, contents) => {
    registerWebContents(contents);
  });

  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  destroyArtWindow();
  closeActiveAuth();
});
