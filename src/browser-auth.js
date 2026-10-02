const { dialog, shell } = require("electron");

/** @type {{ browser?: import('playwright-core').Browser, context?: import('playwright-core').BrowserContext } | null} */
let activeAuth = null;

function mapSameSite(sameSite) {
  if (!sameSite) return "unspecified";
  const value = String(sameSite).toLowerCase();
  if (value === "none") return "no_restriction";
  if (value === "lax" || value === "strict") return value;
  return "unspecified";
}

async function importCookiesToElectron(electronSession, cookies) {
  let imported = 0;
  for (const cookie of cookies) {
    if (!/amazon/i.test(cookie.domain)) continue;

    const host = cookie.domain.startsWith(".")
      ? cookie.domain.slice(1)
      : cookie.domain;
    const scheme = cookie.secure ? "https" : "http";
    const path = cookie.path || "/";
    const url = `${scheme}://${host}${path}`;

    try {
      await electronSession.cookies.set({
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate:
          cookie.expires && cookie.expires > 0 ? cookie.expires : undefined,
        sameSite: mapSameSite(cookie.sameSite),
      });
      imported += 1;
    } catch {
      /* skip invalid cookie entries */
    }
  }
  return imported;
}

async function closeActiveAuth() {
  if (!activeAuth?.browser) return;
  try {
    await activeAuth.browser.close();
  } catch {
    /* ignore */
  }
  activeAuth = null;
}

async function launchAuthBrowser() {
  const { chromium } = require("playwright-core");
  const channels = ["chrome", "msedge"];

  for (const channel of channels) {
    try {
      const browser = await chromium.launch({ channel, headless: false });
      return { browser, channel };
    } catch {
      /* try next channel */
    }
  }

  return null;
}

/**
 * Opens a real browser window for Amazon sign-in (passkeys work there),
 * then copies session cookies into Bloud.
 */
async function startBrowserPasskeySignIn({
  signInUrl,
  electronSession,
  parentWindow,
}) {
  await closeActiveAuth();

  const launched = await launchAuthBrowser();
  if (!launched) {
    await shell.openExternal(signInUrl);
    const { response } = await dialog.showMessageBox(parentWindow, {
      type: "warning",
      buttons: ["OK"],
      title: "Install Chrome for automatic sign-in",
      message: "Opened sign-in in your default browser.",
      detail:
        "For passkeys and automatic session sync into Bloud, install Google Chrome or Microsoft Edge, then try Luna → Sign in with browser (passkey) again.",
    });
    return { ok: false, reason: "no-playwright-browser", userAck: response === 0 };
  }

  const { browser, channel } = launched;
  const context = await browser.newContext();
  const page = await context.newPage();
  activeAuth = { browser, context };

  const browserLabel = channel === "chrome" ? "Google Chrome" : "Microsoft Edge";

  try {
    await page.goto(signInUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  } catch (err) {
    await closeActiveAuth();
    throw new Error(`Could not open Amazon sign-in in ${browserLabel}: ${err.message}`);
  }

  const { response } = await dialog.showMessageBox(parentWindow, {
    type: "info",
    buttons: ["Cancel", "Sync session to Bloud"],
    defaultId: 1,
    cancelId: 0,
    title: "Sign in with passkey",
    message: `Complete sign-in in ${browserLabel}`,
    detail:
      "Use your passkey on the Amazon page. When you are signed in (Luna loaded or Amazon shows your account), click “Sync session to Bloud”.",
  });

  if (response !== 1) {
    await closeActiveAuth();
    return { ok: false, reason: "cancelled" };
  }

  const cookies = await context.cookies();
  const imported = await importCookiesToElectron(electronSession, cookies);
  await closeActiveAuth();

  if (imported === 0) {
    return { ok: false, reason: "no-cookies" };
  }

  return { ok: true, imported };
}

module.exports = {
  startBrowserPasskeySignIn,
  closeActiveAuth,
};
