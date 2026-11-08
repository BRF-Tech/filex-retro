// The program picker: a bundle with no dosbox.conf and more than one DOS
// program asks which one starts the game. The shell's message with a list
// of options (showMessage), one per program, best first (findPrograms); the
// program picked before is marked. Resolves with the program, or with null
// when the person goes back (only offered when there is a program already:
// the first time there is nothing to go back to).

import { dosPath } from './bundle.js';

/**
 * Ask in `shell`'s overlay. `programs` are findPrograms rows, `current` the
 * program in use (or null).
 */
export function pickProgram(shell, programs, current = null) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (p) => {
      if (answered) return;
      answered = true;
      shell.hideOverlay();
      resolve(p);
    };
    shell.setState('pick');
    shell.showMessage((t) => ({
      title: t('dos.pick.title'),
      text: t('dos.pick.text'),
      className: 'rx-dos-pick',
      options: programs.map((prog) => ({
        id: prog.name,
        label: dosPath(prog),
        detail: t('dos.pick.size', { size: new Intl.NumberFormat(shell.locale, { maximumFractionDigits: 1 }).format(prog.size / 1024) }),
        current: !!current && current.name === prog.name,
        onClick: () => done(prog),
      })),
      actions: current ? [{ id: 'pick-back', label: t('shell.close'), onClick: () => done(null) }] : [],
      onEscape: current ? () => done(null) : null,
    }));
  });
}
