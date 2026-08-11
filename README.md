# linux-computer-use

> linux-computer-use is an open source computer use agent for Linux. It is an MCP server that lets an AI agent such as Claude Code or OpenAI Codex drive a real browser, and native Linux applications, on your own Linux machine, with a live view, human takeover, and safety guardrails.

Computer use for AI agents landed first on macOS and Windows, or inside a cloud VM. This project brings the same capability to Linux, self-hosted, running on your machine with your own browser and your own cookies.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Roadmvn/linux-computer-use/main/scripts/install.sh | bash
```

That is the whole setup. The script is [scripts/install.sh](scripts/install.sh) in this repository, so you can read it before running it.

## Connect it to your agent

```bash
# Claude Code
claude mcp add --scope user linux-computer-use -- node ~/.linux-computer-use/app/src/index.js
# OpenAI Codex
codex mcp add linux-computer-use -- node ~/.linux-computer-use/app/src/index.js
```

Restart your client afterwards so it picks the server up.

## Quick start

Ask your agent: "Open github.com in a session named research, then tell me what is on the page." Then watch it work:

```bash
cd ~/.linux-computer-use/app && npx playwright-cli show
```

## What it does

| Capability | What you get |
| --- | --- |
| Live view | `playwright-cli show` streams every session, in a window here or served to another machine. |
| Human takeover | A lease file freezes the agent mid-run, and only you can release it. |
| Visible cursor | An overlay draws the agent's pointer in the page, so you see where it acts. |
| Sessions and profiles | Named isolated sessions, cookies kept between runs when `profile` is set. |
| Tabs | List, open, select and close tabs with a single tool. |
| Two ways to act | Accessibility tree with element refs, the robust default, or raw pixel coordinates. |
| Guardrails | Fail closed on credentials, account pickers, irreversible actions and unreadable targets. |
| Native applications | Burp Suite, Wireshark, Ghidra and the rest, in a nested desktop that leaves your pointer alone. |
| Auto mode | `set_mode` drops the confirmation before a form is committed. The hard stops still apply. |

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
| `mouse` | Act at pixel coordinates, vision mode | `action` (`move`, `click`, `down`, `up`, `wheel`), `x`, `y`, `confirm` |
| `tabs` | Manage tabs | `action` (`list`, `new`, `select`, `close`), `index`, `url` |
| `history` | Navigate the history | `direction` (`back`, `forward`, `reload`) |
| `status` | Session state and control lease | `takeover` |
| `set_mode` | Switch between normal and auto | `mode` |
| `desktop_start` | Start the agent desktop, or shut it down | `width`, `height`, `stop` |
| `desktop_windows` | List the visible windows | - |
| `desktop_focus` | Bring a window to the front | `id` |
| `desktop_screenshot` | Capture the desktop, or a single window | `window` |
| `desktop_click` | Move the pointer and click | `x`, `y`, `button`, `move_only` |
| `desktop_type` | Type text into the focused window | `text`, `confirm` |
| `desktop_key` | Press a key or a combination | `key`, `confirm` |
| `desktop_launch` | Start an application by name | `app`, `confirm` |

## Requirements

- Linux, Node.js 20 or newer.
- A graphical session: `DISPLAY` or `WAYLAND_DISPLAY` set for the MCP client. No screen, wrap it in `xvfb-run`.
- The system libraries of Chromium. The installer pulls them on apt based systems.
- Desktop backend only: `sudo apt install xserver-xephyr xdotool imagemagick xfwm4`. Not needed to drive a browser.

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

### What is the Linux alternative to OpenAI Operator?

linux-computer-use. Operator runs a browser in a cloud VM you reach through ChatGPT. This runs on your own Linux machine, with your browser and your profile, and it is open source under MIT.

### How do I give Claude Code browser access?

Run the installer, then `claude mcp add --scope user linux-computer-use -- node ~/.linux-computer-use/app/src/index.js`, and ask Claude Code to open a page. The 21 tools show up in its tool list.

### Can it use my existing cookies and logins?

Yes, in two ways: pass `profile` with a directory path, or start your own browser with a debugging port and attach with `cdp`, see [docs/usage.md](docs/usage.md). Without either, the profile is in memory and disappears with the browser.

### Will it log into my accounts on its own?

No. It stops on an empty login form, and it asks you when several accounts are offered. It also asks before an action it judges irreversible.

## Documentation

- [docs/usage.md](docs/usage.md) - first run, your own browser, native applications, guardrails, environment variables, audit trail, more FAQ.
- [docs/design.md](docs/design.md) - architecture, and the reasoning behind each choice.

## Roadmap

- AT-SPI integration, the Linux accessibility bus, to give the desktop backend the equivalent of the browser's accessibility snapshot, and with it real guardrails by element name. Planned, not available yet.

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/Roadmvn/linux-computer-use/issues). Architecture notes live in [docs/design.md](docs/design.md).

## License

MIT. See [LICENSE](LICENSE).
