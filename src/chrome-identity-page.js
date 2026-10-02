/**
 * Injected into Amazon / Luna pages so passkey UI treats Bloud like Chrome.
 * Runs in the page main world (not the isolated preload world).
 */
(function installBloudChromeIdentity() {
  if (window.__bloudChromeIdentity) return;
  window.__bloudChromeIdentity = true;

  const chromeVersion = "__CHROME_VERSION__";
  const chromeFull = "__CHROME_FULL__";
  const userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFull} Safari/537.36`;

  try {
    Object.defineProperty(navigator, "userAgent", {
      get: () => userAgent,
      configurable: true,
    });
    Object.defineProperty(navigator, "appVersion", {
      get: () => userAgent.replace(/^Mozilla\//, ""),
      configurable: true,
    });
    Object.defineProperty(navigator, "vendor", {
      get: () => "Google Inc.",
      configurable: true,
    });
    Object.defineProperty(navigator, "platform", {
      get: () => "MacIntel",
      configurable: true,
    });
  } catch {
    /* ignore */
  }

  const brands = [
    { brand: "Google Chrome", version: chromeVersion },
    { brand: "Chromium", version: chromeVersion },
    { brand: "Not_A Brand", version: "24" },
  ];

  const userAgentData = {
    brands,
    mobile: false,
    platform: "macOS",
    getHighEntropyValues: () =>
      Promise.resolve({
        architecture: "arm",
        bitness: "64",
        brands,
        fullVersionList: brands.map((b) => ({
          brand: b.brand,
          version: `${b.version}.0.0.0`,
        })),
        mobile: false,
        model: "",
        platform: "macOS",
        platformVersion: "14.0.0",
        uaFullVersion: `${chromeFull}`,
        wow64: false,
      }),
    toJSON: () => ({ brands, mobile: false, platform: "macOS" }),
  };

  try {
    Object.defineProperty(navigator, "userAgentData", {
      get: () => userAgentData,
      configurable: true,
    });
  } catch {
    /* ignore */
  }

  if (window.chrome && typeof window.chrome === "object") {
    try {
      window.chrome.runtime = window.chrome.runtime || {};
    } catch {
      /* ignore */
    }
  } else {
    try {
      Object.defineProperty(window, "chrome", {
        value: { runtime: {} },
        configurable: true,
      });
    } catch {
      /* ignore */
    }
  }
})();
