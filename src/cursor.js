/**
 * Visible agent cursor.
 *
 * CDP screencast streams the page compositor, which does not include the OS
 * pointer, and injected input events move no real pointer either. So without
 * an overlay a human watching the live view sees things happen with no idea
 * where the agent is acting. This draws a pointer that follows the injected
 * events and pulses on click.
 *
 * The source below is stringified and evaluated in the page, so it must stay
 * self contained and must not reference anything from this module.
 */
function overlay() {
  const doc = document;
  const root = doc.documentElement;

  /**
   * Bumped whenever the listeners change behaviour.
   *
   * Listeners cannot be removed once bound - nothing here holds a reference to
   * them - so a page loaded by an older version keeps its old ones for as long
   * as it lives. Putting the version in the element ids makes those old
   * listeners harmless: they look for ids that no longer exist and do nothing,
   * while the current ones drive the elements they created. Without this, a
   * page open across an upgrade kept following the human's mouse.
   */
  const VERSION = 2;
  const CURSOR_ID = `__lcu_cursor_v${VERSION}`;
  const RING_ID = `__lcu_click_v${VERSION}`;

  // Clear out what an earlier version left behind, but never the current
  // overlay: this runs after every action, and recreating the pointer would
  // snap it back to the middle of the page each time instead of leaving it
  // where the agent last acted.
  for (const el of doc.querySelectorAll('[id^="__lcu_cursor"],[id^="__lcu_click"]')) {
    if (el.id !== CURSOR_ID && el.id !== RING_ID) el.remove();
  }
  if (doc.getElementById(CURSOR_ID) && doc.getElementById(RING_ID)) {
    return 'lcu-cursor-ready';
  }

  const svgNs = 'http://www.w3.org/2000/svg';
  const cursor = doc.createElement('div');
  cursor.id = CURSOR_ID;
  cursor.style.cssText = [
    'position:fixed', 'left:50%', 'top:50%', 'z-index:2147483647',
    'pointer-events:none', 'transition:left .18s ease,top .18s ease',
    'filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))',
  ].join(';');

  const svg = doc.createElementNS(svgNs, 'svg');
  svg.setAttribute('width', '26');
  svg.setAttribute('height', '26');
  svg.setAttribute('viewBox', '0 0 24 24');
  const arrow = doc.createElementNS(svgNs, 'path');
  arrow.setAttribute('d', 'M5 2 L5 20 L10 15 L13 22 L16 20.5 L13 13.8 L20 13.3 Z');
  arrow.setAttribute('fill', '#111');
  arrow.setAttribute('stroke', '#fff');
  arrow.setAttribute('stroke-width', '1.4');
  svg.appendChild(arrow);
  cursor.appendChild(svg);
  root.appendChild(cursor);

  const ring = doc.createElement('div');
  ring.id = RING_ID;
  ring.style.cssText = [
    'position:fixed', 'left:50%', 'top:50%', 'width:36px', 'height:36px',
    'margin:-18px 0 0 -18px', 'z-index:2147483646',
    'border:3px solid rgba(255,60,60,.95)', 'border-radius:50%',
    'pointer-events:none', 'opacity:0', 'transform:scale(.3)',
    'transition:opacity .35s,transform .35s',
  ].join(';');
  root.appendChild(ring);

  /**
   * The pointer only follows events the agent caused.
   *
   * Listening to every mousemove meant the human's own pointer dragged the
   * agent's cursor around, which is backwards: during a takeover the two
   * became indistinguishable. The server raises this flag immediately before
   * it acts, and it expires on its own, so human movement never moves it.
   */
  window.__lcuArm = (ms) => { window.__lcuArmedUntil = Date.now() + (ms || 3000); };
  const armed = () => Date.now() < (window.__lcuArmedUntil || 0);

  // Injected after every action, so bind once per document and per version:
  // otherwise each injection stacks another pair on the same page, and a page
  // that survived an upgrade never gets the new behaviour.
  if (window.__lcuBound === VERSION) return 'lcu-cursor-ready';
  window.__lcuBound = VERSION;

  addEventListener('mousemove', (event) => {
    const el = document.getElementById(CURSOR_ID);
    if (!el || !armed()) return;
    el.style.left = event.clientX + 'px';
    el.style.top = event.clientY + 'px';
  }, true);

  addEventListener('mousedown', (event) => {
    const el = document.getElementById(RING_ID);
    if (!el || !armed()) return;
    el.style.left = event.clientX + 'px';
    el.style.top = event.clientY + 'px';
    el.style.opacity = '1';
    el.style.transform = 'scale(1)';
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'scale(.3)';
    }, 320);
  }, true);

  return 'lcu-cursor-ready';
}

export const CURSOR_SOURCE = `(${overlay.toString()})()`;
