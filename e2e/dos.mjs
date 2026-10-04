// The DOS player's end-to-end scenarios, run by the end-to-end driver in
// the real filex app frame (Chromium, Firefox and WebKit) on the files
// e2e/dos/fixtures.mjs builds from our own DOSPROBE.COM (e2e/dos/probe.asm).
//
// The driver hands its helpers in (`h`): opening a file in a view through
// filex's own page, reading the shell's state, canvas pictures, the file's
// versions and the page's policy record. Each scenario gets a fresh browser
// context and a deadline from the driver.
//
// DOSPROBE.COM draws colour bands that change every timer tick and paints
// its top 20 rows by what it knows of SAVE.TXT: black (none when it
// started), red (W wrote it now), green (it was there when it started). So
// "the program wrote a file, Save kept it, and the reopened bundle has it"
// is read off the screen, not only off the zip.

import path from 'node:path';
import pngjs from 'pngjs';

const { PNG } = pngjs;

/** The colour of the probe's top band in a canvas picture: black, red, green or mixed. */
export function topBand(buf) {
  const p = PNG.sync.read(buf);
  const seen = new Set();
  for (const fx of [0.05, 0.3, 0.5, 0.7, 0.95]) {
    for (const fy of [0.02, 0.05, 0.08]) {
      const x = Math.floor(p.width * fx);
      const y = Math.floor(p.height * fy);
      const i = (y * p.width + x) * 4;
      const [r, g, b] = [p.data[i], p.data[i + 1], p.data[i + 2]];
      if (r < 40 && g < 40 && b < 40) seen.add('black');
      else if (r > 120 && g < 60 && b < 60) seen.add('red');
      else if (g > 120 && r < 60 && b < 60) seen.add('green');
      else seen.add(`other(${r},${g},${b})`);
    }
  }
  return seen.size === 1 ? [...seen][0] : 'mixed:' + [...seen].join('/');
}

export function dosScenarios(h) {
  const { BASE, HDR, W, check, sleep } = h;
  let zipLib = null;
  const zip = async () => (zipLib ||= await import(path.join(W, 'src/src/shell/zip.js')));

  async function download(ctx, name) {
    const r = await ctx.request.get(`${BASE}/api/files/manager?action=download&path=${encodeURIComponent(h.storage() + '://' + name)}`, { headers: HDR });
    if (!r.ok()) throw new Error(`download ${name}: ${r.status()}`);
    return new Uint8Array(await r.body());
  }
  async function contents(ctx, name) {
    const bytes = await download(ctx, name);
    const { readZip } = await zip();
    const out = { size: bytes.length, names: [], text: {}, crc: {} };
    for (const e of readZip(bytes)) {
      out.names.push(e.name);
      out.crc[e.name] = e.crc;
      if (!e.dir && /\.(txt|conf)$/i.test(e.name)) out.text[e.name] = new TextDecoder().decode(await e.data());
    }
    return out;
  }
  async function waitVersions(ctx, name, more, timeout = 30000) {
    const t0 = Date.now();
    let v;
    do {
      v = await h.versions(ctx, name);
      if (v.count > more) return v;
      await sleep(500);
    } while (Date.now() - t0 < timeout);
    return v;
  }
  const button = (frame, action) =>
    frame.evaluate((a) => {
      const b = document.querySelector(`[data-action="${a}"]`);
      return b ? { disabled: b.disabled, hidden: b.hidden, text: b.textContent } : null;
    }, action);
  // The game's changes noticed (the player polls DOS every 3 s), or saved.
  const waitDirty = (frame, on, timeout = 20000) =>
    frame.waitForFunction((v) => document.documentElement.dataset.rxDirty === v, String(on), { timeout }).then(
      () => true,
      () => false,
    );
  const note = (frame) => frame.evaluate(() => document.documentElement.dataset.rxNote || '');
  async function start(frame, where) {
    await frame.click('[data-action="start"]');
    const l = await h.waitState(frame, ['running', 'error', 'ended'], 60000);
    check(where, l.state === 'running', 'did not run ' + JSON.stringify(l));
    return l.state === 'running';
  }
  async function frames(frame, name, where) {
    await sleep(2500);
    const a = await h.shot(frame, name + '-1');
    await sleep(700);
    const b = await h.shot(frame, name + '-2');
    const out = { diff: h.diff(a, b), colors: h.colors(b), band: topBand(b) };
    check(where, out.diff > 0 && out.colors > 16, 'frames still or flat ' + JSON.stringify(out));
    return out;
  }
  async function write(page, frame, name, where) {
    await frame.click('canvas.rx-screen');
    await page.keyboard.press('w');
    await sleep(1200);
    const band = topBand(await h.shot(frame, name));
    check(where, band === 'red', 'the probe did not write SAVE.TXT: top band ' + band);
    return band;
  }

  // ---- bundles the player refuses --------------------------------------------
  async function refusals(ctx, b, out) {
    const cases = [
      ['notzip.jsdos', /a zip file, and this file is not one/],
      ['noprog.jsdos', /no dosbox\.conf and no DOS program/],
    ];
    for (const [file, text] of cases) {
      out.phase = file;
      const { page, frame, rec, P } = await h.openApp(ctx, file, 'dos');
      const l = await h.look(frame);
      out[file] = l;
      check(`${b} dos refusals ${file}`, l.state === 'bad' && text.test(l.overlay || ''), JSON.stringify(l));
      out[file + ':policy'] = await h.policyClean(`${b} dos refusals ${file}`, frame, rec, P);
      await page.close();
    }
  }

  // ---- write, Save, a new version, open again: the file is there ------------
  async function roundTrip(ctx, b, out) {
    const file = `probe-${b}.jsdos`;
    const where = `${b} dos round trip`;
    const before = await contents(ctx, file);
    const v0 = await h.versions(ctx, file);
    out.phase = 'open';
    let { page, frame, rec, P } = await h.openApp(ctx, file, 'dos');
    out.ready = await h.look(frame);
    check(where, out.ready.state === 'ready' && /dosbox\.conf says/.test(out.ready.overlay || ''), 'start screen ' + JSON.stringify(out.ready));
    out.saveAtStart = await button(frame, 'save');
    check(where, !!out.saveAtStart && out.saveAtStart.disabled, 'Save should wait for a change ' + JSON.stringify(out.saveAtStart));
    out.phase = 'start';
    if (!(await start(frame, where))) return;
    out.frames = await frames(frame, `${b}-dos-probe`, where);
    check(where, out.frames.band === 'black', 'top band at start ' + out.frames.band);
    out.audio = (await h.look(frame)).audio;
    if (out.audio !== null) check(where, out.audio === 'running', 'sound is ' + out.audio);
    const played = () => frame.evaluate(() => document.documentElement.dataset.rxSound || '');
    const s1 = await played();
    await sleep(3500);
    const s2 = await played();
    out.sound = { first: s1, second: s2 };
    check(where, /^[0-9]+$/.test(s2) && Number(s2) > Number(s1) && Number(s2) > 0, 'no sound played ' + JSON.stringify(out.sound));

    out.phase = 'write';
    out.band = await write(page, frame, `${b}-dos-probe-wrote`, where);
    out.dirty = await waitDirty(frame, true);
    check(where, out.dirty, 'the written file was not noticed as an unsaved change');
    out.saveAfterWrite = await button(frame, 'save');
    check(where, !!out.saveAfterWrite && !out.saveAfterWrite.disabled, 'Save not offered after the game wrote a file ' + JSON.stringify(out.saveAfterWrite));

    // Saved from a paused player (its settings open): DOS answers anyway.
    out.phase = 'save-paused';
    await frame.click('[data-action="settings"]');
    await sleep(400);
    out.paused = await h.look(frame);
    check(where, out.paused.status === 'Paused', 'settings open but status ' + out.paused.status);
    const p1 = await h.shot(frame, `${b}-dos-paused-1`);
    await sleep(800);
    const p2 = await h.shot(frame, `${b}-dos-paused-2`);
    out.pausedDiff = h.diff(p1, p2);
    check(where, out.pausedDiff === 0, 'the screen moved while paused: ' + out.pausedDiff);
    await frame.click('[data-action="save"]');
    out.v1 = await waitVersions(ctx, file, v0.count);
    check(where, out.v1.count === v0.count + 1, `versions ${v0.count} -> ${out.v1.count}`);
    out.clean = await waitDirty(frame, false);
    check(where, out.clean, 'still unsaved after Save');
    // Saving again with nothing new writes nothing.
    await frame.click('[data-action="save"]');
    await sleep(2500);
    out.again = { versions: (await h.versions(ctx, file)).count, note: await note(frame) };
    check(where, out.again.versions === out.v1.count && /Nothing has changed/.test(out.again.note), 'a save with nothing new ' + JSON.stringify(out.again));
    await frame.click('[data-action="settings-close"]');
    await sleep(800);
    out.resumed = await frames(frame, `${b}-dos-resumed`, where);

    out.phase = 'saved';
    const after = await contents(ctx, file);
    out.saved = { size: after.size, names: after.names, save: after.text['SAVE.TXT'] || null };
    check(where, after.text['SAVE.TXT'] === 'SAVED\r\n', 'SAVE.TXT in the new version: ' + JSON.stringify(out.saved));
    check(where, after.crc['DOSPROBE.COM'] === before.crc['DOSPROBE.COM'] && after.text['.jsdos/dosbox.conf'] === before.text['.jsdos/dosbox.conf'], 'the bundle lost or changed its own files ' + JSON.stringify(after.names));
    out.policy = await h.policyClean(where, frame, rec, P);
    await page.close();

    out.phase = 'reopen';
    ({ page, frame, rec, P } = await h.openApp(ctx, file, 'dos'));
    if (!(await start(frame, where))) return;
    out.reopened = await frames(frame, `${b}-dos-reopened`, where);
    check(where, out.reopened.band === 'green', 'the reopened bundle has no SAVE.TXT for DOS: top band ' + out.reopened.band);

    // The game deletes the file: the next save leaves it out of the bundle.
    out.phase = 'delete';
    await frame.click('canvas.rx-screen');
    await page.keyboard.press('d');
    await sleep(1200);
    out.deletedBand = topBand(await h.shot(frame, `${b}-dos-deleted`));
    check(where, out.deletedBand === 'black', 'the probe did not delete SAVE.TXT: top band ' + out.deletedBand);
    const v2 = await h.versions(ctx, file);
    await frame.click('[data-action="save"]');
    out.v3 = await waitVersions(ctx, file, v2.count);
    check(where, out.v3.count === v2.count + 1, `versions ${v2.count} -> ${out.v3.count}`);
    const gone = await contents(ctx, file);
    out.afterDelete = gone.names;
    check(where, !gone.names.includes('SAVE.TXT') && gone.names.includes('DOSPROBE.COM') && gone.names.includes('.jsdos/dosbox.conf'), 'after the deletion ' + JSON.stringify(gone.names));
    out.policyReopen = await h.policyClean(where + ' reopen', frame, rec, P);
    await page.close();
  }

  // ---- no dosbox.conf: the picker, the remembered pick, the conf on save ----
  async function picker(ctx, b, out) {
    const file = `pick-${b}.jsdos`;
    const where = `${b} dos picker`;
    const v0 = await h.versions(ctx, file);
    out.phase = 'pick';
    let { page, frame, rec, P } = await h.openApp(ctx, file, 'dos');
    out.pick = await h.look(frame);
    out.items = await frame.evaluate(() => [...document.querySelectorAll('.rx-dos-pick__item')].map((x) => x.querySelector('.rx-dos-pick__name').textContent));
    check(where, out.pick.state === 'pick' && JSON.stringify(out.items) === JSON.stringify(['DOSPROBE.COM', 'TOOLS\\OTHER.COM']), 'picker ' + JSON.stringify({ ...out.pick, items: out.items }));
    await frame.click('.rx-dos-pick__item[data-program="DOSPROBE.COM"]');
    out.ready = await h.waitState(frame, ['ready']);
    check(where, /Starts DOSPROBE\.COM\./.test(out.ready.overlay || ''), 'start screen ' + JSON.stringify(out.ready));
    out.saveReady = await button(frame, 'save');
    check(where, !!out.saveReady && !out.saveReady.disabled, 'Save should be offered to keep the picked program ' + JSON.stringify(out.saveReady));
    // filex sends the person's store to the server 400 ms after a change
    // (packages/core lib/prefs, debounced) and not when the page goes away.
    await sleep(1500);
    await page.close();

    out.phase = 'remembered';
    ({ page, frame, rec, P } = await h.openApp(ctx, file, 'dos'));
    out.remembered = await h.look(frame);
    check(where, out.remembered.state === 'ready' && /Starts DOSPROBE\.COM\./.test(out.remembered.overlay || ''), 'not remembered ' + JSON.stringify(out.remembered));
    await frame.click('[data-action="change"]');
    out.change = await h.waitState(frame, ['pick']);
    out.current = await frame.evaluate(() => [...document.querySelectorAll('.rx-dos-pick__item[aria-current="true"]')].map((x) => x.dataset.program));
    check(where, JSON.stringify(out.current) === '["DOSPROBE.COM"]', 'current program ' + JSON.stringify(out.current));
    await frame.click('[data-action="pick-back"]');
    await h.waitState(frame, ['ready']);

    out.phase = 'play';
    if (!(await start(frame, where))) return;
    out.frames = await frames(frame, `${b}-dos-pick`, where);
    out.band = await write(page, frame, `${b}-dos-pick-wrote`, where);
    await waitDirty(frame, true);
    await frame.click('[data-action="save"]');
    out.v1 = await waitVersions(ctx, file, v0.count);
    check(where, out.v1.count === v0.count + 1, `versions ${v0.count} -> ${out.v1.count}`);
    const after = await contents(ctx, file);
    out.saved = { names: after.names, conf: after.text['.jsdos/dosbox.conf'] || null, save: after.text['SAVE.TXT'] || null };
    check(where, /\nDOSPROBE\.COM\n/.test(out.saved.conf || '') && out.saved.save === 'SAVED\r\n' && after.names.includes('TOOLS/OTHER.COM') && after.names.includes('README.TXT'), 'saved bundle ' + JSON.stringify(out.saved));
    out.policy = await h.policyClean(where, frame, rec, P);
    await page.close();

    out.phase = 'reopen';
    ({ page, frame, rec, P } = await h.openApp(ctx, file, 'dos'));
    out.reopen = await h.look(frame);
    check(where, out.reopen.state === 'ready' && /dosbox\.conf says/.test(out.reopen.overlay || ''), 'reopened ' + JSON.stringify(out.reopen));
    if (await start(frame, where)) {
      out.reopened = await frames(frame, `${b}-dos-pick-reopened`, where);
      check(where, out.reopened.band === 'green', 'top band ' + out.reopened.band);
    }
    await page.close();
  }

  // ---- a bundle over 8 MiB: the save is chunked -----------------------------
  async function chunked(ctx, b, out) {
    const file = `big-${b}.jsdos`;
    const where = `${b} dos chunked`;
    const before = await contents(ctx, file);
    const v0 = await h.versions(ctx, file);
    const { page, frame, rec, P } = await h.openApp(ctx, file, 'dos');
    if (!(await start(frame, where))) return;
    out.band = await write(page, frame, `${b}-dos-big-wrote`, where);
    await waitDirty(frame, true);
    const t0 = Date.now();
    await frame.click('[data-action="save"]');
    out.v1 = await waitVersions(ctx, file, v0.count, 60000);
    out.saveMs = Date.now() - t0;
    check(where, out.v1.count === v0.count + 1, `versions ${v0.count} -> ${out.v1.count}`);
    out.requests = rec.requests.filter((r) => r.url.includes('/api/files/plugins/ui/') && r.url.includes('/save')).map((r) => r.method + ' ' + r.url.replace(BASE, '').replace(/path=[^&]*/, 'path=…'));
    check(where, out.requests.some((r) => /chunk=start/.test(r)) && out.requests.some((r) => /final=1/.test(r)), 'not chunked: ' + JSON.stringify(out.requests));
    const after = await contents(ctx, file);
    out.saved = { size: after.size, save: after.text['SAVE.TXT'] || null };
    check(where, after.text['SAVE.TXT'] === 'SAVED\r\n' && after.crc['DATA/NOISE.BIN'] === before.crc['DATA/NOISE.BIN'] && after.size > 9 * 1024 * 1024, 'saved bundle ' + JSON.stringify(out.saved));
    out.policy = await h.policyClean(where, frame, rec, P);
    await page.close();
  }

  // ---- the README's pictures (English interface) ----------------------------
  // The way a person opens it: filex's explorer, a double-click on the file.
  async function openInExplorer(page, file) {
    await page.goto(BASE + '/drive/explore', { waitUntil: 'domcontentloaded' });
    await sleep(3500);
    const tour = page.locator('[aria-label="Onboarding tour"]');
    if (await tour.isVisible().catch(() => false)) {
      await tour.getByRole('button', { name: /skip|close|done|got it|later/i }).first().click({ timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
      await sleep(800);
    }
    if (!(await page.getByText(file, { exact: true }).first().isVisible().catch(() => false))) {
      await page.getByText(h.storage(), { exact: true }).first().click({ timeout: 10000 }).catch(() => {});
      await sleep(2500);
    }
    const row = page.getByText(file, { exact: true }).first();
    await row.waitFor({ timeout: 20000 });
    await sleep(900);
    await row.dblclick();
    const frame = await h.findFrame(page);
    await h.settled(frame);
    await sleep(800);
    return frame;
  }

  async function shots(ctx, b, out) {
    const page = await ctx.newPage();
    const snap = async (name) => {
      await page.screenshot({ path: path.join(h.SHOTS, name + '.png') });
      out.files = (out.files || []).concat(name + '.png');
    };
    out.phase = 'start';
    let frame = await openInExplorer(page, 'probe.jsdos');
    await snap('dos-start');
    await frame.click('[data-action="start"]');
    await h.waitState(frame, ['running'], 60000);
    await sleep(2500);
    await snap('dos-running');
    out.phase = 'picker';
    frame = await openInExplorer(page, 'programs.jsdos');
    await h.waitState(frame, ['pick']);
    await snap('dos-picker');
    out.phase = 'refusal';
    frame = await openInExplorer(page, 'noprog.jsdos');
    await snap('dos-refusal');
    await page.close();
  }

  return { refusals, roundTrip, picker, chunked, shots };
}
