'use strict';
var fs = require('fs');
var path = require('path');
var root = path.resolve(__dirname, '..');
var version = process.argv[2] || require(path.join(root, 'package.json')).version;
var changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
var escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
var match = new RegExp('^##\\s+' + escaped + '\\s*$', 'm').exec(changelog);
if (!match) { console.error('Missing changelog entry for ' + version); process.exit(1); }
var rest = changelog.slice(match.index + match[0].length);
var next = /^##\s+/m.exec(rest);
var body = (next ? rest.slice(0, next.index) : rest).trim();
if (!body) { console.error('Empty changelog entry for ' + version); process.exit(1); }
process.stdout.write(body + '\n');
