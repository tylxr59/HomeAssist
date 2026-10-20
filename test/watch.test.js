'use strict';
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

test('watch handles startup, reply inactivity, user activity, and follow-up cancellation', () => {
  const source = fs.readFileSync('src/c/main.c', 'utf8');
  // Compile the production state and event handlers; replace only Pebble platform/UI APIs.
  const declarations = source.slice(source.indexOf('#define MAX_TRANSCRIPT'), source.indexOf('static void draw_controls'));
  const handlers = source.slice(source.indexOf('static void cancel_idle_timer'), source.indexOf('static void init'));
  const harness = fs.readFileSync('test/helpers/watch-harness.c', 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickassist-watch-'));
  try {
    const input = path.join(dir, 'watch.c'), binary = path.join(dir, 'watch');
    fs.writeFileSync(input, harness.replace('/* WATCH_CODE */', declarations + handlers));
    execFileSync('cc', ['-std=c99', '-Wall', '-Werror', '-Wno-unused-function', '-Wno-unused-variable', input, '-o', binary], {stdio: 'pipe'});
    execFileSync(binary, [], {stdio: 'pipe'});
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
