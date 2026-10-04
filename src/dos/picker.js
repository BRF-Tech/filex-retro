// The program picker: a bundle with no dosbox.conf and more than one DOS
// program asks which one starts the game. A card over the stage (the
// shell's look) with one button per program, best first (findPrograms);
// the program picked before is marked. Resolves with the program, or with
// null when the person goes back (only offered when there is a program
// already: the first time there is nothing to go back to).

import { dosPath } from './bundle.js';

function make(doc, tag, cls, attrs) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/**
 * Show the picker in `shell`'s stage. `programs` are findPrograms rows,
 * `current` the program in use (or null).
 */
export function pickProgram(shell, programs, current = null) {
  const doc = shell.el.stage.ownerDocument;
  return new Promise((resolve) => {
    shell.hideOverlay();
    shell.setState('pick');
    const layer = make(doc, 'div', 'rx-overlay rx-dos-pick');
    const card = make(doc, 'div', 'rx-card', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rx-dos-pick-title' });
    layer.append(card);

    let stopLocale = () => {};
    const done = (p) => {
      stopLocale();
      layer.remove();
      resolve(p);
    };

    const render = () => {
      const t = shell.t;
      card.replaceChildren();
      const h = make(doc, 'h2', 'rx-card__title', { id: 'rx-dos-pick-title' });
      h.textContent = t('dos.pick.title');
      const p = make(doc, 'p', 'rx-card__text');
      p.textContent = t('dos.pick.text');
      const list = make(doc, 'div', 'rx-dos-pick__list', { role: 'list' });
      let focus = null;
      for (const prog of programs) {
        const b = make(doc, 'button', 'rx-btn rx-dos-pick__item', { type: 'button', role: 'listitem', 'data-program': prog.name });
        const name = make(doc, 'span', 'rx-dos-pick__name');
        name.textContent = dosPath(prog);
        const size = make(doc, 'span', 'rx-dos-pick__size');
        size.textContent = t('dos.pick.size', { size: new Intl.NumberFormat(shell.locale, { maximumFractionDigits: 1 }).format(prog.size / 1024) });
        b.append(name, size);
        if (current && current.name === prog.name) {
          b.setAttribute('aria-current', 'true');
          focus = b;
        }
        b.addEventListener('click', () => done(prog));
        list.append(b);
        if (!focus) focus = b;
      }
      card.append(h, p, list);
      if (current) {
        const row = make(doc, 'div', 'rx-card__actions');
        const back = make(doc, 'button', 'rx-btn', { type: 'button', 'data-action': 'pick-back' });
        back.textContent = t('shell.close');
        back.addEventListener('click', () => done(null));
        row.append(back);
        card.append(row);
      }
      return focus;
    };

    layer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && current) {
        e.preventDefault();
        done(null);
      }
    });
    const focus = render();
    stopLocale = shell.onLocale(() => render());
    shell.el.stage.append(layer);
    if (focus) focus.focus();
  });
}
