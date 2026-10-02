# Bloud

Desktop wrapper for [Amazon Luna](https://luna.amazon.com) on **macOS** and **Linux** (including [Bazzite](https://bazzite.gg/) KDE). It runs Luna in a dedicated app window with settings that keep controllers responsive and gives you quick fixes when a game won’t start.

## Install on Linux (one command)

On Bazzite KDE, Fedora, SteamOS, Ubuntu, and other distros:

```bash
curl -fsSL https://raw.githubusercontent.com/TheCodersRish/bloud/main/install-bloud.sh | sh
```

If your shell says `sh: not found`, use the full path (works on Bazzite KDE):

```bash
curl -fsSL https://raw.githubusercontent.com/TheCodersRish/bloud/main/install-bloud.sh | /bin/sh
```

That downloads the latest release AppImage, installs it under `~/.local`, and adds **Bloud** to your app menu. No `sudo` required.

**Open Bloud** (after install):

```bash
~/.local/bin/bloud
```

If that ever fails, reinstall the launcher (same as install):

```bash
curl -fsSL https://raw.githubusercontent.com/TheCodersRish/bloud/main/install-bloud.sh | /bin/sh
```

## Quick start (developers)

**Double-click** `Open Bloud.command` in Finder (first run installs dependencies), or:

```bash
npm install
npm start
```

Sign in with your Amazon account when Luna loads. Your session is saved in Bloud’s own storage (separate from Safari/Chrome).

### Passkeys (Touch ID / iPhone / security key)

Passkeys work in your **real browser**, not inside embedded apps. Bloud opens **Google Chrome** (or Microsoft Edge) for Amazon sign-in, then copies your session into the app.

1. **Luna → Sign in with browser (passkey)** or **⌘⇧L** (or click **Sign in** on Luna — Bloud will open the browser flow).
2. In the **Chrome/Edge** window, sign in with your **passkey** as usual.
3. When you are signed in, return to Bloud and click **Sync session to Bloud**.
4. Luna reloads inside Bloud with your account.

You need **Google Chrome** or **Microsoft Edge** installed for automatic sync. Without them, Bloud opens your default browser but cannot import the session.

## Controllers

Bloud works with the same controllers Luna supports on Mac:

- Amazon Luna Controller (USB-C or Bluetooth; Cloud Direct via the [Luna Controller app](https://apps.apple.com/us/app/luna-controller/id1528364633) on iPhone)
- Xbox One / Xbox Series controller
- PlayStation DualShock 4 / DualSense
- Nintendo Switch Pro Controller
- Mouse and keyboard

**Before you launch a game**

1. Pair the controller in **System Settings → Bluetooth** (or plug in USB-C).
2. Open Bloud and press **⌘G** (menu **Luna → Check controllers**) — you should see your pad listed.
3. Press any button on the controller once so macOS wakes the connection.

Bloud continuously polls gamepad state in the background so Luna sees input the same way it does in Chrome.

## If a game won’t boot

1. **Luna → Reload** (⌘R).
2. Quit the game from Luna’s UI and try again.
3. **Luna → Clear cache & sign-in data** — fixes stale sessions; you’ll sign in again.
4. Use a **5 GHz Wi‑Fi** or Ethernet cable (Luna recommends 10 Mbps+).
5. Unplug/replug USB or toggle Bluetooth if the controller drops mid-session.

## Install as a real app (optional)

### macOS

```bash
npm run dist
```

Open the `.dmg` from `dist/` and drag **Bloud** into Applications.

### Linux

Use the [one-command install](#install-on-linux-one-command) above, or build from source:

```bash
git clone https://github.com/TheCodersRish/bloud.git && cd bloud
./install-bloud.sh --from-source
```

**Bazzite tips**

- Prefer **Google Chrome** or **Microsoft Edge** (Flatpak or layered package) for **Sign in with browser (passkey)** and session sync.
- If `bloud` is not found, ensure `~/.local/bin` is on your `PATH` (many Bazzite images already include it).
- AppImages need FUSE; Bazzite includes it. If launch fails, run: `~/.local/share/bloud/Bloud.AppImage --appimage-extract-and-run`

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘R | Reload Luna |
| ⌘⇧H | Luna home |
| ⌘G | Check controllers |
| ⌃⌘F | Full screen |
