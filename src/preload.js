const { contextBridge } = require("electron");

/**
 * Luna (and most browser games) only see controllers if something polls
 * navigator.getGamepads() regularly. Browsers stop updating gamepad state
 * otherwise. This mirrors what a focused game tab does in Chrome.
 */
function startGamepadPolling() {
  if (!navigator.getGamepads) return;

  let rafId = 0;
  const poll = () => {
    navigator.getGamepads();
    rafId = requestAnimationFrame(poll);
  };

  const start = () => {
    if (!rafId) poll();
  };

  const stop = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  window.addEventListener("gamepadconnected", start);
  window.addEventListener("gamepaddisconnected", () => {
    const hasPad = [...navigator.getGamepads()].some(Boolean);
    if (!hasPad) stop();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") start();
    else stop();
  });

  if (document.visibilityState === "visible") start();
}

window.addEventListener("DOMContentLoaded", startGamepadPolling);

contextBridge.exposeInMainWorld("bloud", {
  version: "1.0.0",
});
