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
  const CURSOR_ID = '__lcu_cursor';
  const RING_ID = '__lcu_click';

  for (const id of [CURSOR_ID, RING_ID]) {
    const previous = doc.getElementById(id);
    if (previous) previous.remove();
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

  addEventListener('mousemove', (event) => {
    cursor.style.left = event.clientX + 'px';
    cursor.style.top = event.clientY + 'px';
  }, true);

  addEventListener('mousedown', (event) => {
    ring.style.left = event.clientX + 'px';
    ring.style.top = event.clientY + 'px';
    ring.style.opacity = '1';
    ring.style.transform = 'scale(1)';
    setTimeout(() => {
      ring.style.opacity = '0';
      ring.style.transform = 'scale(.3)';
    }, 320);
  }, true);

  return 'lcu-cursor-ready';
}

export const CURSOR_SOURCE = `(${overlay.toString()})()`;
