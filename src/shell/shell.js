// The shell every Retro player runs in.
//
// One page per player (doom.html, dos.html); each starts the shell, which
//   - connects to filex (the SDK's handshake; Ctrl+S is NOT taken over, a
//     game owns its keys - in DOOM Ctrl fires),
//   - speaks the reader's language (English or Turkish) and follows filex's
//     colours (the SDK paints `--fe-*` onto <html>),
//   - draws the frame's parts: a bar (title, status, the player's buttons,
//     Settings), the stage the player draws its screen on, and one overlay
//     for the Start screen and for messages,
//   - holds the "Start" gesture: the click that starts a game also starts
//     its sound (an AudioContext made inside that click) and gives the
//     screen the keyboard,
//   - pauses the player while the page is hidden or the settings are open,
//   - keeps the player's settings per person (filex's small store).
//
// A player brings its words, its settings and its screen; everything else
// is here, so the players look and behave alike.

import { LANGUAGES, pickLocale, createTranslator } from './i18n.js';
import { strings as shellStrings } from './strings.js';
import { loadSettings, saveSettings, defaultSettings } from './settings.js';
import { unlockAudio } from './audio.js';

/** A message for an error a bridge call (or anything else) threw. */
export function describeError(t, e) {
  const code = e && typeof e.code === 'string' ? e.code : '';
  const msg = e && typeof e.message === 'string' ? e.message : String(e);
  const known = (k) => t('shell.err.' + k) !== 'shell.err.' + k;
  // A refusal from the server rides as its short code in the message
  // (quota_exceeded, locked, encrypted, not_applicable, busy).
  if (/^[a-z_]+$/.test(msg) && known(msg)) return t('shell.err.' + msg);
  if (code && known(code)) return t('shell.err.' + code);
  return t('shell.err.unknown', { message: msg });
}

function make(doc, tag, cls, attrs) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/**
 * Start the shell. Options:
 *   view      - the player's id ('doom', 'dos'): its settings key
 *   strings   - the player's dictionaries ({en, tr})
 *   settings  - [{key, label, hint?, default}] switches (labels are keys)
 *   mount     - where to draw (default document.body)
 *   connect   - the SDK's connect (default window.FilexAppUI.connect)
 * Resolves with the shell; `shell.fx` is null when filex did not answer (the
 * shell has already said so on screen).
 */
export async function startShell(opts = {}) {
  const doc = opts.doc || globalThis.document;
  const win = doc.defaultView || globalThis;
  const view = opts.view || 'view';
  const schema = opts.settings || [];
  const dicts = [shellStrings, opts.strings || {}];
  const languages = opts.languages || LANGUAGES;

  let locale = pickLocale(win.navigator && win.navigator.language, languages);
  let t = createTranslator(locale, ...dicts);
  const localeListeners = new Set();
  const bound = [];

  const label = (l) => {
    if (l === undefined || l === null) return '';
    if (typeof l === 'string') return t(l);
    if (l.text !== undefined) return String(l.text);
    return t(l.key, l.vars);
  };
  const bindText = (node, l) => {
    node.textContent = label(l);
    bound.push([node, l]);
  };

  // ---- the frame's parts ---------------------------------------------------
  const root = make(doc, 'div', 'rx');
  const bar = make(doc, 'header', 'rx-bar');
  const title = make(doc, 'span', 'rx-title');
  const status = make(doc, 'span', 'rx-status', { role: 'status', 'aria-live': 'polite' });
  const actions = make(doc, 'span', 'rx-actions');
  const stage = make(doc, 'main', 'rx-stage');
  const overlay = make(doc, 'div', 'rx-overlay');
  const panel = make(doc, 'section', 'rx-panel', { role: 'dialog', 'aria-modal': 'false' });
  overlay.hidden = true;
  panel.hidden = true;
  bar.append(title, status, actions);
  stage.append(overlay, panel);
  root.append(bar, stage);
  (opts.mount || doc.body).append(root);
  title.textContent = t('shell.app');

  const html = doc.documentElement;
  const setState = (s) => {
    html.dataset.rxState = s;
  };
  setState('loading');

  // ---- status, with "Paused" over it while paused -------------------------
  let statusLabel = null;
  const reasons = new Set();
  const pauseListeners = new Set();
  const renderStatus = () => {
    status.textContent = reasons.size ? t('shell.paused') : label(statusLabel);
  };
  const setPause = (reason, on) => {
    const before = reasons.size > 0;
    if (on) reasons.add(reason);
    else reasons.delete(reason);
    const after = reasons.size > 0;
    renderStatus();
    if (before !== after) for (const fn of pauseListeners) fn(after, [...reasons]);
  };
  doc.addEventListener('visibilitychange', () => setPause('hidden', !!doc.hidden));

  // ---- the overlay: Start, messages ----------------------------------------
  let overlaySpec = null;
  const renderOverlay = () => {
    overlay.replaceChildren();
    if (!overlaySpec) {
      overlay.hidden = true;
      return;
    }
    const s = typeof overlaySpec.spec === 'function' ? overlaySpec.spec(shell.t) : overlaySpec.spec;
    const card = make(doc, 'div', 'rx-card' + (s.tone === 'error' ? ' rx-card--error' : ''));
    if (s.title) {
      const h = make(doc, 'h2', 'rx-card__title');
      h.textContent = s.title;
      card.append(h);
    }
    for (const line of [].concat(s.text || [], s.lines || [])) {
      if (!line) continue;
      const p = make(doc, 'p', 'rx-card__text');
      p.textContent = line;
      card.append(p);
    }
    const row = make(doc, 'div', 'rx-card__actions');
    let first = null;
    if (overlaySpec.onStart) {
      const b = make(doc, 'button', 'rx-btn rx-btn--primary rx-btn--start', { type: 'button', 'data-action': 'start' });
      b.textContent = s.startLabel || t('shell.start');
      b.addEventListener('click', overlaySpec.onStart);
      row.append(b);
      first = b;
    }
    for (const a of s.actions || []) {
      const b = make(doc, 'button', 'rx-btn' + (a.primary ? ' rx-btn--primary' : ''), { type: 'button' });
      if (a.id) b.dataset.action = a.id;
      b.textContent = a.label;
      b.addEventListener('click', () => a.onClick());
      row.append(b);
      if (!first) first = b;
    }
    if (row.childElementCount) card.append(row);
    if (overlaySpec.onStart) {
      const hint = make(doc, 'p', 'rx-card__hint');
      hint.textContent = s.hint !== undefined ? s.hint : t('shell.startHint');
      if (hint.textContent) card.append(hint);
    }
    overlay.append(card);
    overlay.hidden = false;
    if (first && overlaySpec.focus !== false) first.focus();
  };

  // ---- settings ------------------------------------------------------------
  let values = defaultSettings(schema);
  const settingListeners = new Set();
  let settingsButton = null;
  let focusTarget = null;

  const renderPanel = () => {
    panel.replaceChildren();
    const h = make(doc, 'h2', 'rx-panel__title');
    h.textContent = t('shell.settings');
    panel.append(h);
    for (const s of schema) {
      const row = make(doc, 'label', 'rx-switch');
      const input = make(doc, 'input', 'rx-switch__input', { type: 'checkbox', role: 'switch', 'data-setting': s.key });
      input.checked = !!values[s.key];
      input.addEventListener('change', () => changeSetting(s.key, input.checked));
      const text = make(doc, 'span', 'rx-switch__label');
      text.textContent = label(s.label);
      row.append(input, text);
      if (s.hint) {
        const hint = make(doc, 'span', 'rx-switch__hint');
        hint.textContent = label(s.hint);
        row.append(hint);
      }
      panel.append(row);
    }
    const note = make(doc, 'p', 'rx-panel__note');
    note.textContent = t('shell.settingsNote');
    const close = make(doc, 'button', 'rx-btn', { type: 'button', 'data-action': 'settings-close' });
    close.textContent = t('shell.close');
    close.addEventListener('click', () => closePanel());
    panel.append(note, close);
  };
  const openPanel = () => {
    renderPanel();
    panel.hidden = false;
    setPause('settings', true);
    const first = panel.querySelector('input');
    if (first) first.focus();
  };
  const closePanel = () => {
    if (panel.hidden) return;
    panel.hidden = true;
    setPause('settings', false);
    if (focusTarget) focusTarget.focus();
  };
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePanel();
    }
  });
  const changeSetting = (key, on) => {
    values = { ...values, [key]: !!on };
    for (const fn of settingListeners) fn({ ...values }, key);
    saveSettings(shell.fx, view, schema, values).catch(() => shell.toast(t('shell.settingsFailed'), 'error'));
  };

  // ---- language ------------------------------------------------------------
  const setLocale = (tag) => {
    const next = pickLocale(tag, languages);
    if (next === locale && t.locale === next) return;
    locale = next;
    t = createTranslator(locale, ...dicts);
    for (const [node, l] of bound) node.textContent = label(l);
    renderStatus();
    renderOverlay();
    if (!panel.hidden) renderPanel();
    for (const fn of localeListeners) fn(locale);
  };

  let dirty = false;
  const shell = {
    fx: null,
    session: null,
    view,
    get locale() {
      return locale;
    },
    t: (key, vars) => t(key, vars),
    el: { root, bar, title, status, actions, stage, overlay, panel },
    describeError: (e) => describeError(shell.t, e),

    /** `<html data-rx-state>`: loading, ready, running, message, error… (tests read it). */
    setState,
    /** The bar's title (and the frame's title in filex). A label: key, {key, vars} or {text}. */
    setTitle(l) {
      bound.splice(0, bound.length, ...bound.filter(([n]) => n !== title));
      bindText(title, l);
      if (shell.fx) shell.fx.title(title.textContent);
    },
    setStatus(l) {
      statusLabel = l;
      renderStatus();
    },
    /** A button in the bar, before Settings. */
    addButton({ id, label: l, onClick, primary = false, hidden = false }) {
      const b = make(doc, 'button', 'rx-btn' + (primary ? ' rx-btn--primary' : ''), { type: 'button' });
      if (id) b.dataset.action = id;
      bindText(b, l);
      b.hidden = !!hidden;
      b.addEventListener('click', (e) => onClick && onClick(e));
      actions.insertBefore(b, settingsButton);
      return {
        el: b,
        setLabel(nl) {
          const i = bound.findIndex(([n]) => n === b);
          if (i >= 0) bound.splice(i, 1);
          bindText(b, nl);
        },
        setDisabled(on) {
          b.disabled = !!on;
        },
        setHidden(on) {
          b.hidden = !!on;
        },
      };
    },
    /**
     * The Start screen. `spec` (or `spec(t)`, re-run when the language
     * changes): {title, text, lines, startLabel?, hint?, actions?}. Resolves
     * on the person's click with `{audio}`: an AudioContext made inside that
     * click (null where the browser has none).
     */
    showStart(spec) {
      return new Promise((resolve) => {
        overlaySpec = {
          spec,
          onStart: () => {
            const audio = unlockAudio(win);
            // `<html data-rx-audio>`: the sound's state, for the person's
            // browser tools and the tests (running, suspended, none).
            html.dataset.rxAudio = audio ? audio.state : 'none';
            if (audio) audio.addEventListener('statechange', () => (html.dataset.rxAudio = audio.state));
            overlaySpec = null;
            renderOverlay();
            resolve({ audio });
          },
        };
        renderOverlay();
      });
    },
    /** A message over the stage: {title, text, lines, tone: 'info'|'error', actions: [{id, label, onClick, primary}]}. */
    showMessage(spec, { focus = true } = {}) {
      overlaySpec = { spec, focus };
      renderOverlay();
    },
    hideOverlay() {
      overlaySpec = null;
      renderOverlay();
    },
    /** Where the keyboard goes back to (the game screen) after the shell's own panels. */
    setFocusTarget(node) {
      focusTarget = node;
    },
    get paused() {
      return reasons.size > 0;
    },
    /** `fn(paused, reasons)` whenever the player should stop or may go on. */
    onPause(fn) {
      pauseListeners.add(fn);
      return () => pauseListeners.delete(fn);
    },
    setPause,
    settings: {
      get: (key) => values[key],
      all: () => ({ ...values }),
      /** `fn(values, key)` when the person turns a switch. */
      onChange(fn) {
        settingListeners.add(fn);
        return () => settingListeners.delete(fn);
      },
      open: openPanel,
      close: closePanel,
      /** Shows or hides the Settings button (nothing to set when there is no game). */
      setAvailable(on) {
        if (!on) closePanel();
        if (settingsButton) settingsButton.hidden = !on;
      },
    },
    onLocale(fn) {
      localeListeners.add(fn);
      return () => localeListeners.delete(fn);
    },
    /** Unsaved changes: filex asks before the person leaves them. */
    setDirty(on) {
      if (!!on === dirty) return;
      dirty = !!on;
      if (shell.fx) shell.fx.dirty(dirty);
    },
    get dirty() {
      return dirty;
    },
    /** A note drawn by filex, over the frame (also `<html data-rx-note>`, for tests). */
    toast(text, tone) {
      html.dataset.rxNote = (tone || 'info') + ': ' + text;
      if (shell.fx) shell.fx.toast(text, tone);
    },
  };

  if (schema.length) {
    settingsButton = make(doc, 'button', 'rx-btn', { type: 'button', 'data-action': 'settings' });
    bindText(settingsButton, 'shell.settings');
    settingsButton.addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
    actions.append(settingsButton);
  }

  const connect = opts.connect || (win.FilexAppUI && win.FilexAppUI.connect);
  try {
    if (typeof connect !== 'function') throw new Error('no filex app SDK');
    shell.fx = await connect({ saveShortcut: false, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
  } catch {
    if (settingsButton) settingsButton.hidden = true;
    setState('no-filex');
    shell.showMessage((tt) => ({ title: tt('shell.notInFilexTitle'), text: tt('shell.notInFilex'), tone: 'error' }));
    return shell;
  }
  shell.session = shell.fx.session;
  setLocale(shell.session && shell.session.locale);
  shell.fx.on('locale', (d) => setLocale(d && d.locale));
  values = await loadSettings(shell.fx, view, schema);
  return shell;
}
