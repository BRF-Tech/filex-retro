// The interface's own words, in the reader's language.
//
// filex tells the interface the reader's language (`session.locale`, and a
// `locale` event when it changes). Retro speaks English and Turkish; any
// other language reads English. Every string lives in a dictionary per
// language ({en: {...}, tr: {...}}); a key missing from the reader's
// language falls back to English, and a key missing from English is shown as
// itself, so a forgotten string is visible instead of silent.

export const LANGUAGES = ['en', 'tr'];

/** The language to speak for a language tag (`tr`, `tr-TR`, `pt_BR`). */
export function pickLocale(tag, available = LANGUAGES) {
  const t = String(tag || '').trim().toLowerCase().replace(/_/g, '-');
  if (available.includes(t)) return t;
  const base = t.split('-')[0];
  if (available.includes(base)) return base;
  return available[0];
}

/**
 * A translator for one language over one or more dictionaries (later ones
 * win). `t(key, vars)` fills `{name}` placeholders from `vars`; with a
 * numeric `vars.count`, `key_one` is used for 1 when the dictionary has it.
 */
export function createTranslator(locale, ...dicts) {
  const pick = (lang) => Object.assign({}, ...dicts.map((d) => (d && d[lang]) || {}));
  const fallback = pick('en');
  const own = locale === 'en' ? fallback : pick(locale);

  // The singular form comes from the same language as the word itself: a
  // language without one (Turkish says "1 kayıtlı oyun") never borrows
  // English's.
  const from = (dict, key, one) => (one && dict[key + '_one'] !== undefined ? dict[key + '_one'] : dict[key]);
  function lookup(key, vars) {
    const one = !!(vars && vars.count === 1);
    return from(own, key, one) ?? from(fallback, key, one);
  }

  function t(key, vars) {
    const s = lookup(key, vars);
    if (s === undefined) return key;
    if (!vars) return s;
    return s.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, name) => (vars[name] === undefined ? m : String(vars[name])));
  }
  t.locale = locale;
  return t;
}
