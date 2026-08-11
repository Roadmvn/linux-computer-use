# Design

Why this project is shaped the way it is, and what was deliberately left out.

## The problem

Consumer computer-use agents target macOS and Windows, or run the browser in a
cloud VM. On Linux there was no simple local equivalent. The pieces to build one
all existed already - they were just not assembled.

## What we do not build

The first design for this project reimplemented a live-view server: a CDP
screencast pushed over a WebSocket into a canvas, plus an input relay for human
takeover. That was the wrong call. Playwright ships `playwright-cli`, whose
dashboard already provides:

- a session grid with a live screencast of every session
- a detail view with tab bar, navigation controls and full remote mouse and
  keyboard input
- takeover by clicking into the viewport, release with Escape
- named sessions with separate cookies and storage
- persistent profiles, and storage state save and load

Rebuilding any of that would be duplicated effort with worse results. So this
project wraps `playwright-cli` and adds only what is missing.

The dashboard gesture is an input gesture and nothing more. It gives a human the
keyboard, but the broker never sees it happen, so it does not stop the agent by
itself. What gates the agent is the lease below.

## What we do build

`playwright-cli` states that in the CLI all capabilities are always available -
there is no gating. That is the gap. An agent holding a browser that carries
real cookies can delete a repository or send a message as you. The value added
here is the layer that decides what is allowed.

1. **Credential guardrails.** The agent never types a password. When a login
   form has an empty password field, the run stops and control goes to a human
   through the lease. When the browser password manager already filled the
   field, submitting is the human's own saved intent, so the agent may
   continue. When the page offers several accounts, the agent asks which one.
2. **Irreversible-action guard.** Targets whose accessible name matches a
   destructive verb are refused until the caller passes `confirm: true`, which
   it may only do after asking the human. This holds in auto mode too, and it
   holds for coordinate clicks as well: the element under the pixel is
   identified first and then judged by the same rules, so `mouse` is not a way
   around the check.
3. **Control lease.** Exactly one party drives at a time. The lease is a file,
   not a variable: an agent able to hand control back to itself would make the
   whole thing decorative. It reaches this process through browser tools only
   and has no shell, so it cannot remove the file. Release is therefore out of
   band, a human deleting the file on their own machine, and there is no MCP
   call that takes control back. Observation is not ownership either: a human
   takeover changes the page under the agent's last snapshot, so refs captured
   before are invalid afterwards. Both taking and releasing mark the snapshot
   stale and force a fresh one.
4. **Audit log.** One JSON line per call. Field values are never written, only
   their length, and keystrokes are not written at all, so a typed password
   cannot end up in the log. URLs are cut down to their origin, because paths
   carry magic-link and password-reset tokens.
5. **Visible cursor.** CDP screencast streams the page compositor, which does
   not contain the OS pointer, and injected events move no real pointer. Without
   an overlay a human watching the live view cannot tell where the agent is
   acting. The overlay draws a pointer that pulses on click, and is re-injected
   after every navigation. It is armed by the broker just before it acts, for a
   few seconds, rather than reacting to every pointer event: listening to all of
   them meant the human's own mouse dragged the agent's cursor around, so during
   a takeover the two were indistinguishable.

All of it fails closed. When the target cannot be named or the page cannot be
read, the call is refused, never allowed: a guardrail that opens up when it is
confused protects nothing.

## Architecture

```
Claude Code / OpenAI Codex / any MCP client
      |  MCP over stdio
      v
  linux-computer-use
   |- policy   guardrails, described above
   |- state    lease, mode, snapshot cache, audit
   |- cursor   overlay injected into the page
   |- runner   spawns playwright-cli, argv only, never a shell string
      |
      v
  playwright-cli -s=<session>  ->  Chromium, Chrome, Firefox, or any
      |                             Chromium-based browser over CDP
      +- playwright-cli show   ->  live view and human takeover
```

The broker is an MCP server rather than a CLI wrapper on purpose. A wrapper can
be bypassed: the agent would call `playwright-cli` directly and skip every
guardrail. Exposing the broker over MCP, and not the raw CLI, keeps the rules
on the only path available.

## Modes

- **normal** - sensitive actions are confirmed before they run.
- **auto** - given a complete objective, the agent runs it end to end without
  asking at each step. It still stops for an empty login form, an account
  choice, or an irreversible action.

## Browser and profile

Any Chromium-based browser can be driven by launching it with
`--remote-debugging-port` and attaching with the `cdp` argument. Firefox and
WebKit work through Playwright's own launcher.

Note that since Chromium 136, `--remote-debugging-port` is ignored when the
browser runs on its default profile directory. This is a deliberate protection:
the debugging port grants read access to every cookie in the profile. Use a
separate profile directory. To start from an existing logged-in state, copy the
session files into a dedicated profile rather than pointing the port at your
daily one, or log in once in the agent profile and let it persist.

Whatever profile it holds, the agent inherits those sessions. Treat the profile
as the real permission boundary, and keep a clean one for untrusted targets.

## Interaction model

Two ways to act, both available:

- **Accessibility tree** - `snapshot` returns refs, `click` and `fill` use
  them. Exact, cheap in tokens, robust to layout changes. The default.
- **Coordinates** - `screenshot` then `mouse`. For canvas, maps and custom
  widgets with no accessible element.

Neither is sufficient alone, which is why both are exposed.

## Known limits

- Guardrail detection is heuristic. Names are matched on word boundaries
  against verb lists, and the irreversible list is a starting point,
  configurable through `LCU_IRREVERSIBLE`. Login and account-chooser detection
  reads the page and will not recognise every design.
- The control lease is explicit, not observed. The broker cannot see a takeover
  happen in the dashboard, so a human who wants to stop the agent without
  waiting for it to offer has to create the lease file themselves.
- The browser is driven, not the desktop. Native windows, file pickers and
  desktop applications are out of reach for now.

## Roadmap

An X11 desktop backend, so native application windows can be captured and
driven alongside the browser. Window capture and input injection were both
verified to work on X11 before this was written down; only the integration
remains.
