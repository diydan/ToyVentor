// Expressions (for `page.evaluate`) that drive the ONE menu (kip-menu.js) the way a person does: a real change event on its select, a real click on its
// switch, a real input event on its slider. Control ids are the menu's own (`#km-<id>`); the Truck declares them in parts/kip/viewer/truck-menu.js.
// Each expression returns true when the control exists and ended up showing the value asked for (a control that refuses, as the giant-tyre switch does in
// Stage 2a, is reported as false: the menu repaints it from the bench's state straight after the event).
const q = (id) => `document.getElementById('km-${id}')`;

export const menu = {
  select: (id, value) => `(() => { const el = ${q(id)}; if (!el) return false; el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('change', { bubbles: true })); return el.value === ${JSON.stringify(String(value))}; })()`,
  toggle: (id, on) => `(() => { const el = ${q(id)}; if (!el) return false; if (el.checked !== ${Boolean(on)}) el.click(); return el.checked === ${Boolean(on)}; })()`,
  range: (id, value) => `(() => { const el = ${q(id)}; if (!el) return false; el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('input', { bubbles: true })); return Number(el.value) === Number(${JSON.stringify(String(value))}); })()`,
  action: (id) => `(() => { const el = ${q(id)}; if (!el) return false; el.click(); return true; })()`,
  /** The value a control shows right now (select value, switch state, slider value) or null when it is not there. */
  value: (id) => `(() => { const el = ${q(id)}; return el ? (el.type === 'checkbox' ? el.checked : el.value) : null; })()`,
  /** Is the control's field drawn (not hidden by its `visibleWhen`)? */
  visible: (id) => `(() => { const el = ${q(id)}; return !!el && !el.closest('.km-field')?.hidden; })()`,
  text: (id) => `(() => { const el = ${q(id)}; return el ? el.textContent : null; })()`,
};
