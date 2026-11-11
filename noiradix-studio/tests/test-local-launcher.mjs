import assert from 'node:assert/strict';
import http from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { browserCommand, launchStudio } from '../tools/launch-studio.mjs';
import { sha256, stagePortable } from '../tools/package-studio.mjs';
import { studioBuildId, studioInstanceId } from '../tools/studio-server.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'noiradix-portable-test-'));
const servers = [];
const log = () => {};
const options = { openBrowser: false, log, serverOptions: { apiKey: '', authDirectory: path.join(temporary, 'auth-config') } };
const runCommand = promisify(execFile);
try {
  // A foreign service on the requested port must stay up and never get reused.
  const foreign = http.createServer((req, res) => { res.writeHead(200); res.end('Other application'); });
  servers.push(foreign);
  await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
  const port = foreign.address().port;
  const opened = [];
  const first = await launchStudio({ ...options, port, openBrowser: true, open: url => opened.push(url) });
  servers.push(first.server);
  assert.equal(first.reused, false);
  assert.notEqual(Number(new URL(first.url).port), port);
  assert.deepEqual(opened, [first.url]);
  assert.equal(await (await fetch('http://127.0.0.1:' + port)).text(), 'Other application');
  const info = await (await fetch(first.url + 'api/studio/info')).json();
  assert.equal(info.application, 'noiradix-studio');
  assert.equal(info.build, studioBuildId);
  assert(!JSON.stringify(info).includes(process.cwd()), 'Do not expose the root path');
  assert.equal((await fetch(first.url)).status, 200, 'The app is ready before returning');
  const second = await launchStudio({ ...options, port });
  assert.equal(second.reused, true); assert.equal(second.server, null); assert.equal(second.url, first.url);
  const separate = await launchStudio({ ...options, port, rootDir: temporary });
  servers.push(separate.server);
  assert.equal(separate.reused, false); assert.notEqual(separate.url, first.url, 'A different project copy gets its own server');
  await assert.rejects(() => launchStudio({ ...options, port: -1 }), /không hợp lệ/);
  await assert.rejects(() => launchStudio({ ...options, port, attempts: 1 }), /cổng localhost trống/);
  assert.deepEqual(browserCommand(first.url, 'darwin'), ['/usr/bin/open', [first.url]]);
  assert.deepEqual(browserCommand(first.url, 'win32'), ['rundll32.exe', ['url.dll,FileProtocolHandler', first.url]]);
  assert.deepEqual(browserCommand(first.url, 'linux'), ['xdg-open', [first.url]]);

  // A previous build in the same checkout must not keep old validation code
  // alive behind freshly served frontend files. Keep it running, use a new port.
  const stale = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ application: 'noiradix-studio', instance: studioInstanceId(rootDirForStale), build: 'old-build' }));
  });
  const rootDirForStale = fileURLToPath(new URL('..', import.meta.url));
  servers.push(stale); await new Promise(resolve => stale.listen(0, '127.0.0.1', resolve));
  const stalePort = stale.address().port;
  const updated = await launchStudio({ ...options, port: stalePort }); servers.push(updated.server);
  assert.equal(updated.reused, false); assert.notEqual(new URL(updated.url).port, String(stalePort));
  assert.equal((await (await fetch('http://127.0.0.1:' + stalePort + '/api/studio/info')).json()).build, 'old-build', 'previous session is left intact');

  // Stage both OS layouts with fake runtimes; this test never downloads or runs binaries.
  const binary = path.join(temporary, 'fixture-node');
  const license = path.join(temporary, 'fixture-license');
  await writeFile(binary, 'portable-runtime-test-fixture');
  await writeFile(license, 'upstream-license-fixture');
  const runtimes = Object.fromEntries(['darwin-arm64', 'darwin-x64', 'win-x64', 'win-arm64'].map(target => [target, { binary, license }]));
  const rootDir = fileURLToPath(new URL('..', import.meta.url));
  async function files(directory, prefix = '') {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), name + '/'));
      else result.push(name);
    }
    return result;
  }
  for (const platform of ['macos', 'windows']) {
    const destination = path.join(temporary, platform);
    const manifest = await stagePortable({ rootDir, destination, platform, runtimes });
    assert.equal(manifest.platform, platform); assert.equal(manifest.runtimes.length, 2);
    const contents = await files(destination);
    // pix2/test-vectors are public specification examples, not the developer test tree.
    assert.equal(contents.some(name => name.startsWith('tests/')), false);
    assert.equal(contents.some(name => name.split('/').some(part => part.startsWith('.') && part !== '.env.example')), false);
    for (const name of ['index.html', 'BAT-DAU.txt', 'docs/AI_CHAT.md', 'docs/LOCALHOST.md', 'docs/GOOGLE_LOGIN.md', 'docs/ACCOUNT_TEAM.md', 'js/ai-account-team.js', 'js/ai-google-settings.js', 'tools/account-team.mjs', 'tools/launch-studio.mjs', 'tools/studio-server.mjs', 'tools/studio-agent.mjs', 'tools/chatgpt-auth.mjs', 'tools/responses-stream.mjs', 'tools/google-acp.mjs', 'tools/google-acp-client.mjs', 'tools/google-acp-runtime.mjs', '.env.example']) assert(contents.includes(name));
    assert(!contents.some(name => /agy_acp_server|google-acp-check/.test(name)), 'Google proprietary runtimes are downloaded on the recipient machine, not redistributed in the portable');
    assert(!contents.includes('tools/package-studio.mjs'));
    assert(!contents.includes('.env.local')); assert(!contents.includes('.git/config'));
    assert(!contents.some(name => name.includes('vscode-pix2')));
    for (const runtime of manifest.runtimes) {
      const executable = path.join(destination, 'runtime', runtime.target, platform === 'windows' ? 'node.exe' : 'node');
      assert.equal(await sha256(executable), runtime.sha256);
      assert.equal(await readFile(path.join(path.dirname(executable), 'LICENSE.txt'), 'utf8'), 'upstream-license-fixture');
      if (platform === 'macos' && process.platform !== 'win32') assert((await stat(executable)).mode & 0o100);
    }
    const launcher = path.join(destination, manifest.entry);
    const source = await readFile(launcher, 'utf8');
    assert(source.includes('launch-studio.mjs'));
    assert(!source.includes('index.html"'), 'The launcher must run localhost, not file://');
    if (platform === 'macos') { if (process.platform !== 'win32') assert((await stat(launcher)).mode & 0o100); }
    else { assert(source.includes('%~dp0') && source.includes('PROCESSOR_ARCHITEW6432')); assert(!/(?<!\r)\n/.test(source)); }
  }
  // Add secret fixtures to a throwaway source tree, never to the user's checkout.
  const fixtureSource = path.join(temporary, 'macos');
  await writeFile(path.join(fixtureSource, 'start-noiradix-studio.command'), await readFile(path.join(rootDir, 'start-noiradix-studio.command')));
  await writeFile(path.join(fixtureSource, '.env.local'), 'OPENAI_API_KEY=private-test-fixture');
  await writeFile(path.join(fixtureSource, 'js/.env.local'), 'private-nested-test-fixture');
  await writeFile(path.join(fixtureSource, 'docs/chatgpt-auth.json'), '{"refreshToken":"private-auth-fixture"}');
  await mkdir(path.join(fixtureSource, '.git'));
  await writeFile(path.join(fixtureSource, '.git/config'), 'private-git-fixture');
  if (process.platform !== 'win32') await symlink(path.join(fixtureSource, '.env.local'), path.join(fixtureSource, 'js/leak.js'));
  const safeCopy = path.join(temporary, 'safe-copy');
  await stagePortable({ rootDir: fixtureSource, destination: safeCopy, platform: 'macos', runtimes });
  const safeFiles = await files(safeCopy);
  assert(!safeFiles.includes('.env.local') && !safeFiles.includes('js/.env.local') && !safeFiles.includes('.git/config') && !safeFiles.includes('js/leak.js'));
  assert(!safeFiles.includes('docs/chatgpt-auth.json'));
  if (process.platform !== 'win32') {
    const fixture = path.join(temporary, 'Mac permission checks');
    const runtime = path.join(fixture, 'runtime', 'darwin-' + (process.arch === 'arm64' ? 'arm64' : 'x64'));
    await mkdir(runtime, { recursive: true });
    await mkdir(path.join(fixture, 'tools'));
    await symlink(process.execPath, path.join(runtime, 'node'));
    const launcher = path.join(fixture, 'Open.command');
    await writeFile(launcher, await readFile(path.join(rootDir, 'start-noiradix-studio.command')));
    const entry = path.join(fixture, 'tools', 'launch-studio.mjs');
    await writeFile(entry, 'throw Object.assign(new Error("test permission denial"), { code: "EPERM", path: import.meta.filename });');
    const checkHint = error => {
      assert.equal(error.code, 1); assert(error.stderr.includes('Desktop Folder') && error.stderr.includes('Terminal') && error.stderr.includes('⌘Q'));
      assert(!error.stderr.includes('node:fs:') && !error.stderr.includes('getSourceSync'));
      return true;
    };
    await assert.rejects(() => runCommand('/bin/bash', [launcher, '--no-open']), checkHint);
    await writeFile(entry, 'if (!process.argv.includes("--no-open") || process.argv[1] !== import.meta.filename) throw new Error("Launcher arguments changed"); export const test = true;');
    if (process.getuid?.() !== 0) {
      await chmod(entry, 0);
      try { await assert.rejects(() => runCommand('/bin/bash', [launcher, '--no-open']), checkHint); }
      finally { await chmod(entry, 0o600); }
    }
    assert.equal((await runCommand('/bin/bash', [launcher, '--no-open'])).stderr, '', 'Readable modules still load normally');
    console.log('macOS launcher permission handling passed: EPERM message, real EACCES during entry-module loading, readable modules and argument forwarding.');
  }
  console.log('Local launcher passed: ready-before-open, busy port fallback, same-copy reuse, separate copies, invalid/exhausted ports and browser commands.');
  console.log('Portable staging passed: macOS/Windows architectures, executable modes, licenses/checksums, public assets and exclusion of credentials/developer files.');
} finally {
  for (const server of servers) {
    if (!server?.listening) continue;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await rm(temporary, { recursive: true, force: true });
}
