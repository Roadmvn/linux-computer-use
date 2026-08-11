# linux-computer-use

> linux-computer-use is an open source computer use agent for Linux. It is an MCP server that lets an AI agent such as Claude Code or OpenAI Codex drive a real browser, and native Linux applications, on your own Linux machine, with a live view, human takeover, and safety guardrails.

Computer use and browser automation for AI agents landed first on macOS and Windows, or inside a cloud VM. This project brings the same capability to Linux, self-hosted, running locally on your machine with your own browser and your own cookies.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Roadmvn/linux-computer-use/main/scripts/install.sh | bash
```

That is the whole setup. The script is [scripts/install.sh](scripts/install.sh) in this repository, so you can read it before running it.

## Contents

- [What is linux-computer-use](#what-is-linux-computer-use)
- [Requirements](#requirements)
- [Connect it to your agent](#connect-it-to-your-agent)
- [First run](#first-run)
- [Use your own browser](#use-your-own-browser)
- [Drive native applications](#drive-native-applications)
- [Features](#features)
- [MCP tools](#mcp-tools)
- [How it works](#how-it-works)
- [Comparison](#comparison)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## What is linux-computer-use

It is a Model Context Protocol (MCP) server, written in Node.js, that exposes 21 tools: 13 for the browser and 8 for native applications. Any MCP client can call them: Claude Code, OpenAI Codex, or your own agent. The agent opens a session, navigates, reads the page, clicks, types, and switches tabs, on a browser that runs on your Linux desktop and that you can watch in real time. It also drives native applications such as Burp Suite or Wireshark, in a nested desktop of its own, see [Drive native applications](#drive-native-applications).

Two things make it usable for real work instead of demos:

- you can watch what it is doing, live, and freeze it at any moment from your own machine
- the agent stops and asks before login screens, account pickers, and irreversible actions

It launches the bundled Chromium, your installed Chrome, Edge, Firefox or WebKit, and it attaches over CDP to any Chromium-based browser you started yourself, Brave, Opera and Vivaldi included.

## Requirements

- Linux
- Node.js 20 or newer
- A graphical session. The browser opens a real window, so `DISPLAY` or `WAYLAND_DISPLAY` must be set in the environment of the MCP client that starts the server. When neither is set, `open` returns a plain message saying so instead of a stack trace. On a machine with no screen, wrap the client in `xvfb-run`.
- System libraries for the bundled browser. The installer pulls them automatically on apt based systems. Elsewhere, install your distribution's Chromium dependencies yourself: nss, cups, gbm, alsa, atk, xkbcommon and X11.
- A browser is optional. The installer downloads a bundled Chromium, which is what the `open` tool uses by default. `chrome` and `msedge` use the copy already installed on the machine. `firefox` and `webkit` need their Playwright builds first: `cd ~/.linux-computer-use/app && npx playwright install firefox`.
- For the desktop backend only: Xephyr (package `xserver-xephyr` on Debian, Ubuntu and Kali), `xdotool`, ImageMagick for its `import` command, and a window manager, `xfwm4` or `openbox` or `fluxbox`. On apt systems that is `sudo apt install xserver-xephyr xdotool imagemagick xfwm4`. The installer checks for them and prints that line when one is missing; it does not install them for you. The nested desktop opens on your existing graphical session, so `DISPLAY` must be set. None of this is needed to drive a browser.

## Connect it to your agent

The installer prints these two commands with the right path at the end of the
install. By default it puts the server in `~/.linux-computer-use/app`.

Claude Code:

```bash
claude mcp add --scope user linux-computer-use -- node ~/.linux-computer-use/app/src/index.js
```

OpenAI Codex:

```bash
codex mcp add linux-computer-use -- node ~/.linux-computer-use/app/src/index.js
```

Any other MCP client: register `node ~/.linux-computer-use/app/src/index.js` as a stdio MCP server. See the [Model Context Protocol documentation](https://modelcontextprotocol.io) if your client uses a config file instead of a CLI.

Restart your client afterwards so it picks the server up.

## First run

Ask your agent to open something. For example:

```
Open github.com in a session named research, then tell me what is on the page.
```

The agent calls `open`, which launches a browser window on your desktop, or attaches to one you already started. The agent's cursor is drawn on the page so you can see where it acts.

The dashboard is a separate program and the server never starts it for you. Run it yourself, on this machine:

```bash
cd ~/.linux-computer-use/app && npx playwright-cli show
```

That opens a native window listing every session, with a live view of each one.

To watch from another machine, serve it over HTTP and open the URL it prints:

```bash
cd ~/.linux-computer-use/app && npx playwright-cli show --port=7777 --host=0.0.0.0
```

Warning: there is no authentication in front of that port. Anyone who can reach it drives your browser. Bind it to a private interface address or a VPN address rather than `0.0.0.0` whenever you can.

Handing control to a human is a separate mechanism from the dashboard, described in [Human takeover](#human-takeover).

## Use your own browser

### Why

The bundled Chromium starts empty: no cookies, no history, no accounts. Point the agent at a browser that already carries your sessions and it works on the sites you are signed into, without logging in again anywhere.

### The two commands

Start your browser with a debugging port and a dedicated profile directory:

```bash
<browser> --remote-debugging-port=9222 --user-data-dir="$HOME/.lcu-profile"
```

`<browser>` is whichever binary you use: `google-chrome`, `chromium`, `brave-browser`, `opera`, `microsoft-edge` or `vivaldi`. They are all Chromium based and take the same two flags. Write the directory out as `$HOME/...`, since a `~` after an `=` is not expanded by the shell and would create a directory literally named `~`.

Then have the agent attach instead of launching, by calling `open` with `cdp: "http://127.0.0.1:9222"`. Asking for it in words is enough:

```
Open github.com through the browser already running on CDP port 9222.
```

The `browser` and `profile` parameters are ignored when `cdp` is set, since the running browser already has its own.

### Chromium 136 and later

Since Chromium 136, `--remote-debugging-port` is ignored when the browser runs on its default profile directory. Nothing fails loudly, the port simply never opens. This is a deliberate protection: the debugging port grants read access to every cookie in the profile it is attached to. A separate `--user-data-dir` is therefore mandatory, not a suggestion.

### Seeding a dedicated profile with your existing sessions

Close the browser first. These files are locked and half written while it runs.

Copy from your everyday profile into the dedicated one:

- `Local State`, at the root of the profile directory
- `Default/Cookies`
- `Default/Preferences`
- `Default/Local Storage`, the whole directory

```bash
SRC="$HOME/.config/google-chrome"
DST="$HOME/.lcu-profile"
mkdir -p "$DST/Default"
cp "$SRC/Local State" "$DST/"
cp "$SRC/Default/Cookies" "$SRC/Default/Preferences" "$DST/Default/"
cp -r "$SRC/Default/Local Storage" "$DST/Default/"
```

Usual profile directories:

| Browser | Profile directory |
| --- | --- |
| Chrome | `~/.config/google-chrome` |
| Chromium | `~/.config/chromium` |
| Brave | `~/.config/BraveSoftware/Brave-Browser` |
| Opera | `~/.config/opera` |

Other Chromium-based browsers follow the same shape under `~/.config/<browser>`. Snap and Flatpak packages do not: they keep the profile under `~/snap/<package>/current/` and `~/.var/app/<app-id>/config/` respectively. Check where your browser actually writes before copying.

Warning: the agent inherits every session that profile carries. The profile is the security boundary, not the prompt you wrote. Keep a profile with nothing signed into it for targets you do not control. And for as long as the browser runs with a debugging port open, any local process can read those cookies through it, not only this server.

## Drive native applications

A browser is not the whole machine. The desktop backend lets the agent work in Burp Suite, Wireshark, Ghidra, a file manager or any other application installed on your system, without taking your mouse away from you.

It needs the packages listed in [Requirements](#requirements). The browser backend is unaffected if they are missing.

### The agent gets a desktop of its own

`desktop_start` opens a nested X display with Xephyr, inside a resizable window titled "agent desktop", and runs `xfwm4` in it as the window manager. The default size is 1280x800. Everything the agent launches lives in that window. You can minimise it and carry on working: its pointer, its focus and its window stack are separate from yours.

The window is deliberately unobtrusive. When it is created it hands the keyboard straight back to whatever you were using, so it never interrupts you mid-sentence, and it is started with `-no-host-grab` so passing the mouse over it does not capture your keyboard and pointer. It comes to the front when you click it, and not before.

That is not a stylistic preference. Two limits of X11 were measured before settling on it:

1. On a shared display, `xdotool` drives the single core pointer. The agent would take the mouse out of your hand for as long as it works, and you could not use the machine in the meantime.
2. Sending input to a window in the background does not work. The `--window` option of `xdotool` goes through `XSendEvent`, and modern toolkits, Chromium, Java/Swing and Electron among them, ignore those synthetic events on purpose. In testing, neither the keystrokes nor the clicks were received, and the window stole the focus on the way.

A nested display is therefore the only arrangement where the agent works while you keep using your machine.

### Applications keep their configuration

Application configuration lives on disk per user, not per display. Burp Suite started on the agent desktop reads the same settings, extensions and CA certificate as the one you start yourself, from `~/.java/.userPrefs/burp`, and the system VPN applies to it like to any other process. There is no second environment to set up.

### The desktop survives a server restart

Xephyr is started detached, and the display number and the pids are written to `~/.linux-computer-use/desktop.json`. So when your MCP client restarts the server, `desktop_start` reattaches to the desktop already running, with the applications still open inside it, instead of opening a second one and abandoning the first.

### Desktop tools

| Tool | What it does | Parameters |
| --- | --- | --- |
| `desktop_start` | Start the agent desktop, or shut it down. Required before any other desktop tool | `width`, `height`, `stop` |
| `desktop_windows` | List the visible windows, with id, title, class and geometry | - |
| `desktop_focus` | Bring a window to the front | `id` |
| `desktop_screenshot` | Capture the whole desktop, or a single window | `window` |
| `desktop_click` | Move the pointer and click | `x`, `y`, `button`, `move_only` |
| `desktop_type` | Type text into the focused window | `text`, `confirm` |
| `desktop_key` | Press a key or a combination, for example `Return`, `ctrl+c` or `alt+Tab` | `key`, `confirm` |
| `desktop_launch` | Start an application, found by name in the desktop catalog | `app`, `confirm` |

### Example

Asking in words is enough:

```
Start the agent desktop, open Burp Suite in it, and describe what you see.
```

The agent calls `desktop_start`, and a window opens on your screen. Then `desktop_launch` with `burp`, matched against the `.desktop` catalog in `/usr/share/applications`, `/usr/local/share/applications` and `~/.local/share/applications`. Applications take a few seconds to map their window, so `desktop_windows` comes next, then `desktop_screenshot` to read the interface. From there the agent works from coordinates with `desktop_click`, `desktop_type` and `desktop_key`.

### Guardrails on this path

- Application allowlist. By default `burpsuite`, `wireshark`, `firefox`, `firefox-esr`, `chromium`, `zaproxy`, `ghidra`, `cutter`, `gedit`, `mousepad`, `thunar`. Anything outside it needs `confirm: true`. Replace the list with `LCU_APPS`, comma separated.
- Terminal detection. When the focused window belongs to a terminal class, `xterm`, `konsole`, `alacritty`, `kitty`, `tilix`, `urxvt`, `wezterm` and the like, `desktop_type` and `desktop_key` are refused until the call is repeated with `confirm: true`, because a shell acts on whatever it receives.
- The control lease covers these tools as well. While `~/.linux-computer-use/lease` exists, every desktop call is refused, exactly like the browser calls. See [Human takeover](#human-takeover).
- The audit log records the call: the tool, the coordinates of a click, the application launched, and for `desktop_type` the number of characters. The text typed and the key pressed are never written.

### What the desktop path does not protect you from

On the desktop, the agent clicks blind. This is worth reading before you point it at something that matters.

The browser path has an accessibility tree. The server can read that a button is named "Delete account" and refuse the click. On the desktop there are only pixels, so no check by element name is possible at all: nothing distinguishes an OK button from a "Delete everything" button.

Concretely, the credential guard, the irreversible-action guard, the account-choice guard and the refusal on unidentifiable targets do not apply to `desktop_click`, `desktop_type` and `desktop_key`. What remains is the application allowlist, terminal detection and the lease.

The desktop path therefore offers weaker guarantees than the browser path. That is a deliberate trade-off, not an oversight: the alternative was shipping no desktop backend at all. Give it applications you would accept seeing clicked around in, keep the "agent desktop" window somewhere you can see it, and take the lease when you want it to stop. Checks by element name are on the [Roadmap](#roadmap), through AT-SPI.

## Features

### Live view in a dashboard

`playwright-cli show` streams every session. Run without options it opens a native window on the machine. With `--port` and `--host` it serves a page instead, so you can watch a run from another machine. It is a separate process from the MCP server: start it when you want to watch, close it when you do not.

### Human takeover

The lease decides who drives, and it lives in a file, not in the dashboard.

- the agent hands control over by calling `status` with `takeover: true`, which creates `~/.linux-computer-use/lease`
- while that file exists, every action from the agent is refused, `open` and `goto` included
- the agent cannot take control back. This is deliberate: it holds browser tools and no shell, so it has no way to remove the file
- you release control by deleting it: `rm ~/.linux-computer-use/lease`
- after a release the agent must call `snapshot` again. Whatever you did may have changed the page, so every ref captured before the takeover is treated as invalid

The file is the whole protocol, so you do not have to wait for the agent to offer. Creating it yourself stops the agent mid-run:

```bash
touch ~/.linux-computer-use/lease   # freeze the agent
rm ~/.linux-computer-use/lease      # give it back
```

Clicking into the viewport in the dashboard does give you the keyboard and mouse, but the server does not see it. Only the lease file stops the agent.

### Visible agent cursor

An overlay draws a pointer in the page, because a CDP screencast carries the page compositor and not the OS pointer. The server arms the overlay immediately before it acts, so the pointer follows the agent's own moves and clicks and nothing else. It marks an action as it happens rather than announcing it beforehand, and it does not move when you move your own mouse.

### Sessions and profiles

Sessions are named and isolated, each with its own cookies and tabs. Cookies survive between runs only when you pass `profile` with a directory path: without it the profile lives in memory and dies with the browser. To reuse a profile you already have, attach to a running browser over `cdp` instead, see [Use your own browser](#use-your-own-browser).

### Tab management

List, open, select, and close tabs with a single tool.

### Two ways to act

- accessibility tree: `snapshot` returns the page as a structured tree with a ref for each element, and `click` or `fill` target those refs. This is the robust path and should be the default.
- pixel coordinates: `mouse` acts at an x/y position, for canvas, custom widgets, and anything the accessibility tree does not describe.

### Guardrails

The guardrails fail closed. When the target cannot be identified or the page cannot be read, the action is refused rather than allowed.

- Credentials. `fill` is refused on a field whose name looks like a password. `type` and `press` are refused while a password field has focus. `press` is refused as well when a login form with an empty password field is on screen, since a key could submit it. Navigation keys pass: Tab, Escape, arrows, Page Up and Down, Home, End, function keys.
- Account choice. When the page offers several accounts and the target carries an email address, the agent stops and asks which one.
- Irreversible actions. A target whose accessible name matches a verb such as delete, deploy, publish, purchase or send is refused until the caller repeats the call with `confirm: true`, which it may only set after asking you. The list is configurable through `LCU_IRREVERSIBLE`.
- Word boundaries. Names are matched on word boundaries, so "Dropbox" is not read as "drop" and "Sendgrid" is not read as "send". A guardrail that cries wolf on ordinary product names gets switched off by its users.
- Unknown targets. If the element cannot be named, or the page state cannot be read, the call is refused. Call `snapshot` and use a ref that comes from it.
- Stale refs. After anything that can change the page, `click` and `fill` are refused until a fresh `snapshot`.
- Coordinates are not a way around any of this. A `mouse` click is checked like a click by ref: the element under the pixel is identified and judged by the same rules.

### Audit trail

One JSON line per call, in `~/.linux-computer-use/audit.log`, created with owner-only permissions. It records the tool, the session and counters. It never writes the text of a field and never writes which key was pressed, so a password typed one press at a time cannot be reconstructed from it. URLs are reduced to their origin, because paths carry magic-link and password-reset tokens.

### Modes

Two modes, switched with `set_mode`.

- `normal` asks before the agent commits a form, meaning a target named Save, Submit, Create, Confirm, Apply or Post.
- `auto` drops that checkpoint and chains the steps to the end.

Both modes stop hard on: entering a credential, submitting a login form whose password field is empty, a page offering several accounts, an action judged irreversible, and any action at all while you hold the lease. `confirm: true` only unblocks the irreversible check and the normal-mode form checkpoint. Nothing unblocks the credential rules or the lease from the agent side. A name that sits on both lists, `Send` for instance, counts as irreversible, so it stops in auto mode too.

## MCP tools

| Tool | What it does | Parameters |
| --- | --- | --- |
| `open` | Open or attach a browser session | `url`, `session`, `profile`, `browser`, `cdp` |
| `goto` | Navigate to a URL | `url` |
| `snapshot` | Accessibility tree of the page, with element refs | - |
| `screenshot` | Image capture of the page | - |
| `click` | Click an element by ref | `ref`, `confirm` |
| `type` | Type text | `text` |
| `fill` | Fill a field by ref | `ref`, `text` |
| `press` | Press a key | `key` |
| `mouse` | Mouse by coordinates, vision mode | `action` (`move`, `click`, `down`, `up`, `wheel`), `x`, `y`, `confirm` |
| `tabs` | Manage tabs | `action` (`list`, `new`, `select`, `close`), `index`, `url` |
| `history` | History navigation | `direction` (`back`, `forward`, `reload`) |
| `status` | Session state and control lease | `takeover` |
| `set_mode` | Switch between normal and auto | `mode` |

`browser` accepts `chromium`, the default and the bundled build, plus `chrome`, `firefox`, `webkit` and `msedge`. Brave, Opera and Vivaldi are not values here: reach them with `cdp`, as described in [Use your own browser](#use-your-own-browser). `browser` and `profile` are both ignored when `cdp` is set.

The eight tools of the desktop backend are listed in [Desktop tools](#desktop-tools), which brings the total to 21.

### Environment variables

| Variable | What it does |
| --- | --- |
| `LCU_HOME` | Where the installer puts the server. Defaults to `~/.linux-computer-use`. |
| `LCU_DATA_DIR` | Where the lease file and the audit log are written. Defaults to `~/.linux-computer-use`. |
| `LCU_IRREVERSIBLE` | Replaces the list of verbs treated as irreversible, comma separated. |
| `LCU_APPS` | Replaces the list of applications `desktop_launch` may start without `confirm`, comma separated. |
| `LCU_PLAYWRIGHT_CLI` | Path to an alternative `playwright-cli`, used instead of the bundled one. |

## How it works

The server is a Node.js process speaking MCP over stdio. Under the hood it wraps [playwright-cli](https://playwright.dev) (`@playwright/cli`) from Microsoft, which handles the browser drivers, the named sessions, and the `show` command that renders the live view.

What this project adds on top:

- the safety layer that pauses on logins, account choices, and irreversible actions
- a control lease held in a file, so the agent and the human are never driving at the same time and the agent cannot take control back on its own
- an audit trail of what the agent did
- the visible cursor overlay
- the desktop backend, which does not go through Playwright at all: a nested X display served by Xephyr, input through `xdotool`, capture through the `import` command of ImageMagick

Everything runs on your machine. There is no cloud VM in the loop and no browser session hosted by a third party.

## Comparison

| | Platform | Where it runs | Live view | Human takeover | Guardrails | Open source |
| --- | --- | --- | --- | --- | --- | --- |
| linux-computer-use | Linux | Your machine | Yes, `playwright-cli show`, locally or served | Yes, explicit lease released from your machine | Yes | Yes, MIT |
| OpenAI Operator / ChatGPT agent | Any, used through ChatGPT | Cloud VM | Yes | Yes | Yes | No |
| Anthropic Claude for Chrome | Chrome extension | Your browser | Your own browser window | - | Yes | No |
| Playwright MCP | Cross platform | Your machine | Yes | Yes | - | Yes |

A dash means not verified rather than absent. These products move fast, so check their own documentation before relying on a row.

## FAQ

### Can AI control a browser on Linux?

Yes. Install this MCP server, register it with Claude Code, OpenAI Codex, or any MCP client, and the agent drives Chromium, Chrome, or Firefox on your Linux machine while you watch.

### Does computer use work on Linux?

The mainstream computer use products target macOS and Windows or run the browser in a cloud VM. On Linux, this project gives you the equivalent locally, for the browser and for native applications.

### What is the Linux alternative to OpenAI Operator?

linux-computer-use. Operator runs a browser in a cloud VM you reach through ChatGPT. This runs on your own Linux machine, with your browser and your profile, and it is open source under MIT.

### How do I give Claude Code browser access?

Run the installer, then `claude mcp add --scope user linux-computer-use -- node ~/.linux-computer-use/app/src/index.js`, and ask Claude Code to open a page. The 21 tools show up in its tool list.

### Does it work with OpenAI Codex?

Yes. `codex mcp add linux-computer-use -- node ~/.linux-computer-use/app/src/index.js`. Any MCP client works the same way, this is a plain stdio MCP server.

### Can I watch what the agent is doing?

Yes, once you start the dashboard yourself with `cd ~/.linux-computer-use/app && npx playwright-cli show`. The server does not start it for you. The agent's cursor is drawn on the page so you see where it acts.

### How do I take back control mid-run?

The agent hands control over by calling `status` with `takeover: true`, which creates `~/.linux-computer-use/lease`. While that file exists every agent action is refused, and the agent has no way to remove it. You give control back with `rm ~/.linux-computer-use/lease`, and the agent then has to call `snapshot` again before it can click anything. Taking the mouse in the dashboard is not enough on its own: the server does not detect it.

### Can it use my existing cookies and logins?

Yes, in two ways. Pass `profile` with a directory path and that session keeps its cookies between runs. Or start your own browser with a debugging port and attach with `cdp`, which reuses the sessions that profile already carries, see [Use your own browser](#use-your-own-browser). Without either, the profile is in memory and disappears with the browser.

### Will it log into my accounts on its own?

No. It stops on an empty login form, and it asks you when several accounts are offered. It also asks before an action it judges irreversible.

### Which browsers are supported?

The `browser` parameter launches `chromium`, the bundled default, or `chrome`, `firefox`, `webkit` and `msedge`. Brave, Opera and Vivaldi cannot be named there. Start them yourself with `--remote-debugging-port` and attach with `cdp`, which is also how you reuse a profile you are already logged into.

### Can it drive native Linux applications, not just a browser?

Yes. `desktop_start` opens a nested X display for the agent, and it drives applications in there with `desktop_launch`, `desktop_click`, `desktop_type` and `desktop_key`. Your own pointer and focus are untouched, so you keep using the machine while it works. Read [What the desktop path does not protect you from](#what-the-desktop-path-does-not-protect-you-from) first: on the desktop the agent works from pixels, so the guardrails are much thinner than on the browser path.

### Is my browsing sent to a cloud service?

No. The server, the browser, and the dashboard all run on your machine.

### How is this different from using Playwright MCP directly?

The browser drivers, the named sessions and the live view come from playwright-cli. This project adds the safety layer, the control lease between agent and human, the audit trail, and the visible cursor, and packages it as a one-line install.

## Roadmap

- AT-SPI integration, the Linux accessibility bus, to give the desktop backend the equivalent of the browser's accessibility snapshot, and with it real guardrails by element name. Planned, not available yet.

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/Roadmvn/linux-computer-use/issues). Architecture notes live in [docs/design.md](docs/design.md).

## License

MIT. See [LICENSE](LICENSE).
