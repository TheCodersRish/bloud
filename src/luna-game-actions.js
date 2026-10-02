/**
 * Runs inside Luna pages to exit a session or read artwork for the game-art window.
 */
(function bloudLunaGameActions() {
  function clickByLabel(pattern) {
    const nodes = document.querySelectorAll(
      'button, a, [role="button"], [role="menuitem"]'
    );
    for (const node of nodes) {
      const label =
        (node.textContent || "") +
        " " +
        (node.getAttribute("aria-label") || "");
      if (pattern.test(label)) {
        node.click();
        return true;
      }
    }
    return false;
  }

  function dispatchShiftTab() {
    const opts = {
      key: "Tab",
      code: "Tab",
      keyCode: 9,
      which: 9,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", opts));
    window.dispatchEvent(new KeyboardEvent("keyup", opts));
    document.dispatchEvent(new KeyboardEvent("keydown", opts));
    document.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  window.__bloudExitLunaGame = function () {
    dispatchShiftTab();
    const clickedExit =
      clickByLabel(/\b(exit|quit|leave)\b.*\b(game|session)?\b/i) ||
      clickByLabel(/\bquit\b/i) ||
      clickByLabel(/\bexit game\b/i);
    return { clickedExit, href: location.href };
  };

  window.__bloudExtractGameArt = function () {
    const og = document.querySelector('meta[property="og:image"]');
    if (og && og.content) {
      return {
        imageUrl: og.content,
        title: document.title.replace(/\s*[-|–].*Amazon Luna.*/i, "").trim(),
      };
    }

    let best = null;
    let bestArea = 0;
    for (const img of document.querySelectorAll("img")) {
      const rect = img.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea && img.src && !img.src.startsWith("data:")) {
        bestArea = area;
        best = img;
      }
    }

    const titleEl = document.querySelector("h1, h2");
    return {
      imageUrl: best ? best.src : null,
      title: titleEl
        ? titleEl.textContent.trim()
        : document.title.replace(/\s*[-|–].*Amazon Luna.*/i, "").trim(),
    };
  };

  window.__bloudLooksLikeInGame = function () {
    const href = location.href;
    if (!/luna\.amazon\.com/i.test(href)) return false;
    if (/luna\.amazon\.com\/?(?:#|\?|$)/i.test(href) && !/play|game|session|stream/i.test(href)) {
      return false;
    }
    return (
      /play|game|session|stream|gamelink|launch/i.test(href) ||
      document.fullscreenElement != null ||
      !!document.querySelector("video, canvas")
    );
  };
})();
