(function installLunaGamePermissions() {
  if (window.__bloudLunaGamePerms) return;
  window.__bloudLunaGamePerms = true;

  const grantedNames = new Set([
    "pointer-lock",
    "keyboard-lock",
    "fullscreen",
    "gamepad",
  ]);

  if (navigator.permissions && navigator.permissions.query) {
    const nativeQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (descriptor) => {
      if (descriptor && grantedNames.has(descriptor.name)) {
        return Promise.resolve({ state: "granted", onchange: null });
      }
      return nativeQuery(descriptor);
    };
  }
})();
