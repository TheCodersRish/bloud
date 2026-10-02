const fs = require("fs");
const path = require("path");

const AMAZON_HOST_SUFFIXES = [
  "amazon.com",
  "amazon.co.uk",
  "amazon.ca",
  "amazon.de",
  "amazon.fr",
  "amazon.it",
  "amazon.es",
  "amazon.co.jp",
  "amazon.com.au",
  "amazon.in",
  "amazon.com.mx",
  "amazon.com.br",
];

function isAmazonHost(hostname) {
  return AMAZON_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
  );
}

function isAmazonPageUrl(url) {
  try {
    const { hostname } = new URL(url);
    return isAmazonHost(hostname) || hostname === "luna.amazon.com";
  } catch {
    return false;
  }
}

function buildUserAgent(chromeFullVersion) {
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFullVersion} Safari/537.36`;
}

function buildChromeIdentityScript(chromeFullVersion) {
  const major = chromeFullVersion.split(".")[0];
  const template = fs.readFileSync(
    path.join(__dirname, "chrome-identity-page.js"),
    "utf8"
  );
  return template
    .replaceAll("__CHROME_VERSION__", major)
    .replaceAll("__CHROME_FULL__", chromeFullVersion);
}

function amazonRequestFilter() {
  return {
    urls: AMAZON_HOST_SUFFIXES.flatMap((suffix) => [
      `https://*.${suffix}/*`,
      `http://*.${suffix}/*`,
    ]).concat(["https://luna.amazon.com/*", "http://luna.amazon.com/*"]),
  };
}

const lunaPermissionsScript = fs.readFileSync(
  path.join(__dirname, "luna-game-permissions-page.js"),
  "utf8"
);

function configureAmazonSession(session, chromeFullVersion) {
  const userAgent = buildUserAgent(chromeFullVersion);
  const chromeMajor = chromeFullVersion.split(".")[0];
  const identityScript = buildChromeIdentityScript(chromeFullVersion);

  session.setUserAgent(userAgent);

  session.webRequest.onHeadersReceived(
    { urls: ["https://luna.amazon.com/*", "https://*.amazon.com/*"] },
    (details, callback) => {
      if (!details.responseHeaders) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      const headers = { ...details.responseHeaders };
      headers["Permissions-Policy"] = [
        "keyboard-lock=*, pointer-lock=*, fullscreen=*, gamepad=*",
      ];
      callback({ responseHeaders: headers });
    }
  );

  session.webRequest.onBeforeSendHeaders(amazonRequestFilter(), (details, callback) => {
    const headers = { ...details.requestHeaders };
    headers["User-Agent"] = userAgent;
    headers["Sec-CH-UA"] =
      `"Google Chrome";v="${chromeMajor}", "Chromium";v="${chromeMajor}", "Not_A Brand";v="24"`;
    headers["Sec-CH-UA-Mobile"] = "?0";
    headers["Sec-CH-UA-Platform"] = '"macOS"';
    callback({ requestHeaders: headers });
  });

  return { userAgent, identityScript, lunaPermissionsScript };
}

async function injectChromeIdentity(webContents, identityScript) {
  if (!webContents || webContents.isDestroyed()) return;
  const url = webContents.getURL();
  if (!isAmazonPageUrl(url)) return;

  const frames = webContents.mainFrame?.framesInSubtree || [];
  for (const frame of frames) {
    if (!frame || frame.isDestroyed()) continue;
    try {
      await frame.executeJavaScript(identityScript, true);
    } catch {
      /* cross-origin iframes */
    }
  }
}

function attachChromeIdentityToWebContents(webContents, identityScript) {
  const run = () => {
    injectChromeIdentity(webContents, identityScript).catch(() => {});
  };

  webContents.on("dom-ready", run);
  webContents.on("did-navigate-in-page", run);
}

async function injectLunaPermissions(webContents, lunaPermissionsScript) {
  if (!webContents || webContents.isDestroyed()) return;
  const url = webContents.getURL();
  if (!url.includes("luna.amazon.com")) return;

  const frames = webContents.mainFrame?.framesInSubtree || [];
  for (const frame of frames) {
    if (!frame || frame.isDestroyed()) continue;
    try {
      await frame.executeJavaScript(lunaPermissionsScript, true);
    } catch {
      /* cross-origin iframes */
    }
  }
}

function attachLunaPermissionsToWebContents(webContents, lunaPermissionsScript) {
  const run = () => {
    injectLunaPermissions(webContents, lunaPermissionsScript).catch(() => {});
  };

  webContents.on("dom-ready", run);
  webContents.on("did-navigate-in-page", run);
}

module.exports = {
  AMAZON_HOST_SUFFIXES,
  isAmazonHost,
  isAmazonPageUrl,
  buildUserAgent,
  configureAmazonSession,
  attachChromeIdentityToWebContents,
  attachLunaPermissionsToWebContents,
};
