# linux-computer-use

> linux-computer-use is an open source computer use agent for Linux. It is an MCP server that lets an AI agent such as Claude Code or OpenAI Codex drive a real browser on your own Linux machine, with a live view, human takeover, and safety guardrails.

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
- [Features](#features)
- [MCP tools](#mcp-tools)
- [How it works](#how-it-works)
- [Comparison](#comparison)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## What is linux-computer-use

It is a Model Context Protocol (MCP) server, written in Node.js, that exposes browser control as 13 tools. Any MCP client can call them: Claude Code, OpenAI Codex, or your own agent. The agent opens a session, navigates, reads the page, clicks, types, and switches tabs, on a browser that runs on your Linux desktop and that you can watch in real time.

Two things make it usable for real work instead of demos:

- you can see what the agent is doing, live, and take the keyboard back at any moment
- the agent stops and asks before login screens, account pickers, and irreversible actions

It drives Chromium, Chrome, Firefox, and any Chromium-based browser (Brave, Opera, Edge) over CDP.

## Requirements

- Linux
- Node.js 20 or newer
- A browser: Chromium, Chrome, Firefox, or any Chromium-based browser

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

The agent calls `open`, which starts or attaches a browser session and gives you the dashboard for the live view. From there you watch every action, and the agent's cursor is drawn on screen so you can see exactly where it clicks.

To take over: click inside the viewport in the dashboard. You now control the browser directly, and the agent waits. Press Escape to hand control back.

## Features

### Live view in a dashboard

The browser session is streamed to a web dashboard. It is a normal web page, so you can open it from another machine on your network and watch a run remotely.

### Human takeover

Click in the viewport to take control, press Escape to return it to the agent. Useful for a password, a captcha you want to solve yourself, or a step you would rather do by hand.

### Visible agent cursor

An overlay draws the agent's pointer on the page. You always know where it is about to click, which makes a run readable instead of a wall of tool calls.

### Sessions and profiles

Sessions are named and isolated. Profiles persist, so a session keeps its cookies between runs, and you can reuse an existing browser profile instead of logging in again in every automation.

### Tab management

List, open, select, and close tabs with a single tool.

### Two ways to act

- accessibility tree: `snapshot` returns the page as a structured tree with a ref for each element, and `click` or `fill` target those refs. This is the robust path and should be the default.
- pixel coordinates: `mouse` acts at an x/y position, for canvas, custom widgets, and anything the accessibility tree does not describe.

### Guardrails

The server stops the agent and asks you when it matters:

- an empty login form: the agent does not type credentials on its own
- several accounts offered: it asks which one
- an irreversible action: it asks for confirmation before going through

### Auto mode

If the objective you gave is complete enough to run unattended, switch to auto mode with `set_mode` and the agent chains steps to the end without stopping at every checkpoint.

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
| `mouse` | Mouse by coordinates, vision mode | `action`, `x`, `y` |
| `tabs` | Manage tabs | `action` (`list`, `new`, `select`, `close`), `index`, `url` |
| `history` | History navigation | `direction` (`back`, `forward`, `reload`) |
| `status` | Session state and control lease | `takeover` |
| `set_mode` | Switch between normal and auto | `mode` |

## How it works

The server is a Node.js process speaking MCP over stdio. Under the hood it wraps [playwright-cli](https://playwright.dev) (`@playwright/cli`) from Microsoft, which handles the browser drivers, the live dashboard, and the takeover mechanism.

What this project adds on top:

- the safety layer that pauses on logins, account choices, and irreversible actions
- a control lease, so the agent and the human are never driving at the same time
- an audit trail of what the agent did
- the visible cursor overlay

Everything runs on your machine. There is no cloud VM in the loop and no browser session hosted by a third party.

## Comparison

| | Platform | Where it runs | Live view | Human takeover | Guardrails | Open source |
| --- | --- | --- | --- | --- | --- | --- |
| linux-computer-use | Linux | Your machine | Yes, web dashboard | Yes, click to take over, Escape to return | Yes | Yes, MIT |
| OpenAI Operator / ChatGPT agent | Any, used through ChatGPT | Cloud VM | Yes | Yes | Yes | No |
| Anthropic Claude for Chrome | Chrome extension | Your browser | Your own browser window | - | Yes | No |
| Playwright MCP | Cross platform | Your machine | Yes | Yes | - | Yes |

A dash means not verified rather than absent. These products move fast, so check their own documentation before relying on a row.

## FAQ

### Can AI control a browser on Linux?

Yes. Install this MCP server, register it with Claude Code, OpenAI Codex, or any MCP client, and the agent drives Chromium, Chrome, or Firefox on your Linux machine while you watch.

### Does computer use work on Linux?

The mainstream computer use products target macOS and Windows or run the browser in a cloud VM. On Linux, this project gives you the equivalent locally, limited to the browser.

### What is the Linux alternative to OpenAI Operator?

linux-computer-use. Operator runs a browser in a cloud VM you reach through ChatGPT. This runs on your own Linux machine, with your browser and your profile, and it is open source under MIT.

### How do I give Claude Code browser access?

Run the installer, then `claude mcp add --scope user linux-computer-use -- node ~/.linux-computer-use/app/src/index.js`, and ask Claude Code to open a page. The 13 tools show up in its tool list.

### Does it work with OpenAI Codex?

Yes. `codex mcp add linux-computer-use -- node ~/.linux-computer-use/app/src/index.js`. Any MCP client works the same way, this is a plain stdio MCP server.

### Can I watch what the agent is doing?

Yes. Every session has a live view in a web dashboard, and the agent's cursor is drawn on the page so you see where it clicks.

### How do I take back control mid-run?

Click inside the viewport in the dashboard. The agent stops acting and waits. Press Escape to give control back.

### Can it use my existing cookies and logins?

Yes. Sessions support persistent profiles, and you can point a session at an existing browser profile so you are already logged in.

### Will it log into my accounts on its own?

No. It stops on an empty login form, and it asks you when several accounts are offered. It also asks before an action it judges irreversible.

### Which browsers are supported?

Chromium, Chrome, Firefox, and Chromium-based browsers such as Brave, Opera, and Edge.

### Is my browsing sent to a cloud service?

No. The server, the browser, and the dashboard all run on your machine.

### How is this different from using Playwright MCP directly?

The live dashboard and the takeover come from playwright-cli. This project adds the safety layer, the control lease between agent and human, the audit trail, and the visible cursor, and packages it as a one-line install.

## Roadmap

- an X11 desktop backend, to drive native Linux applications and not only the browser. Planned, not available yet.

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/Roadmvn/linux-computer-use/issues). Architecture notes live in [docs/design.md](docs/design.md).

## License

MIT. See [LICENSE](LICENSE).
