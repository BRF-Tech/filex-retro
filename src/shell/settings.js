// A view's settings: switches the person turns on and off, kept per person
// in filex's small store for this app (`state.get` / `state.set`, in the
// account's preferences, 8 KiB a value). They follow the person, not the
// file, and never go into a game file.
//
// A schema is a list of `{key, label, hint?, default}`; every value is a
// boolean. Anything stored that the schema does not name is dropped, and a
// value of the wrong type reads as the default, so an old or damaged entry
// never breaks a view.

export function settingsKey(view) {
  return 'settings.' + view;
}

export function defaultSettings(schema) {
  const out = {};
  for (const s of schema) out[s.key] = !!s.default;
  return out;
}

export function normalizeSettings(schema, stored) {
  const out = defaultSettings(schema);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;
  for (const s of schema) {
    if (typeof stored[s.key] === 'boolean') out[s.key] = stored[s.key];
  }
  return out;
}

/** Reads the person's settings for `view`; the defaults when there are none or the store fails. */
export async function loadSettings(fx, view, schema) {
  if (!fx || !schema.length) return defaultSettings(schema);
  try {
    return normalizeSettings(schema, await fx.state.get(settingsKey(view)));
  } catch {
    return defaultSettings(schema);
  }
}

/** Keeps the person's settings for `view` (only the keys the schema names). */
export async function saveSettings(fx, view, schema, values) {
  const clean = normalizeSettings(schema, values);
  if (fx) await fx.state.set(settingsKey(view), clean);
  return clean;
}
