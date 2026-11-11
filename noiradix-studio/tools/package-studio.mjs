import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const run = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeVersion = 'v24.22.2';
const targets = { macos: ['darwin-arm64', 'darwin-x64'], windows: ['win-x64', 'win-arm64'] };
const publicTrees = ['css', 'js', 'engine', 'pixelart', 'pix2', 'specification', 'docs'];
const publicFiles = ['index.html', 'site.webmanifest', 'noiradix-studio-logo.svg', 'noiradix-studio-logo-cute-arms-outline-fixed.svg',
  'privacy.html', 'terms.html', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'PIX2_SPECIFICATION.md', '.env.example', 'BAT-DAU.txt'];
const serverFiles = ['studio-server.mjs', 'studio-agent.mjs', 'launch-studio.mjs', 'chatgpt-auth.mjs', 'responses-stream.mjs',
  'ai-providers.mjs', 'ai-agent-manager.mjs', 'ai-context.mjs', 'ai-usage.mjs', 'account-team.mjs', 'google-acp.mjs', 'google-acp-client.mjs', 'google-acp-runtime.mjs'];
const publicExtensions = new Set(['.html', '.js', '.css', '.json', '.md', '.pix2', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.woff2', '.woff', '.ttf', '.webmanifest']);

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function copyPublicTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'chatgpt-auth.json' || entry.isSymbolicLink()) continue;
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyPublicTree(from, to);
    else if (entry.isFile() && (publicExtensions.has(path.extname(entry.name).toLowerCase()) || /^LICENSE(?:-|$)/.test(entry.name))) await copyFile(from, to);
  }
}
async function copyRegular(source, destination) {
  if (!(await lstat(source)).isFile()) throw new Error('Từ chối đóng gói file liên kết hoặc file đặc biệt: ' + path.basename(source));
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination, constants.COPYFILE_FICLONE);
}

/** Explicit public inputs only. Never copy the whole checkout or its .env.local. */
export async function stagePortable({ rootDir = projectRoot, destination, platform, runtimes, version = nodeVersion }) {
  if (!targets[platform]) throw new Error('Chọn macos hoặc windows.');
  await mkdir(destination, { recursive: true });
  for (const filename of publicFiles) await copyRegular(path.join(rootDir, filename), path.join(destination, filename));
  for (const directory of publicTrees) await copyPublicTree(path.join(rootDir, directory), path.join(destination, directory));
  for (const filename of serverFiles) await copyRegular(path.join(rootDir, 'tools', filename), path.join(destination, 'tools', filename));
  await copyRegular(path.join(rootDir, 'samples/Noiradix_Ghost.pix2'), path.join(destination, 'samples/Noiradix_Ghost.pix2'));
  const launcher = platform === 'macos' ? 'start-noiradix-studio.command' : 'start-noiradix-studio.bat';
  const entry = platform === 'macos' ? 'Mo Studio.command' : 'Mo Studio.bat';
  await copyRegular(path.join(rootDir, launcher), path.join(destination, entry));
  if (platform === 'macos') await chmod(path.join(destination, entry), 0o755);
  else await writeFile(path.join(destination, entry), (await readFile(path.join(destination, entry), 'utf8')).replace(/\r?\n/g, '\r\n'));
  const manifest = { application: 'NOIRADIX Studio', platform, nodeVersion: version, entry, runtimes: [] };
  for (const target of targets[platform]) {
    const runtime = runtimes[target];
    if (!runtime) throw new Error('Thiếu bộ chạy ' + target);
    const filename = target.startsWith('win-') ? 'node.exe' : 'node';
    const output = path.join(destination, 'runtime', target, filename);
    await copyRegular(runtime.binary, output);
    await copyRegular(runtime.license, path.join(destination, 'runtime', target, 'LICENSE.txt'));
    if (platform === 'macos') await chmod(output, 0o755);
    manifest.runtimes.push({ target, sha256: await sha256(output), archiveSha256: runtime.archiveSha256 || null });
  }
  await writeFile(path.join(destination, 'BUNDLE-INFO.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

async function downloadChecked(filename, version, checksums, cache) {
  const expected = checksums.get(filename);
  if (!expected) throw new Error('Không có SHA-256 chính thức cho ' + filename);
  const output = path.join(cache, filename);
  try { if (await sha256(output) === expected) return { output, checksum: expected }; } catch { /* Not cached yet. */ }
  console.log('Đang tải bộ chạy chính thức: ' + filename);
  const response = await fetch(`https://nodejs.org/dist/${version}/${filename}`, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Không tải được ${filename}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('SHA-256 không khớp. Đã dừng đóng gói: ' + filename);
  const temporary = output + '.download-' + process.pid;
  await writeFile(temporary, bytes);
  await rename(temporary, output);
  return { output, checksum: expected };
}

export async function packageStudio({ platform = 'all', version = nodeVersion, output = path.join(projectRoot, 'dist') } = {}) {
  if (!['all', ...Object.keys(targets)].includes(platform) || !/^v(?:2[2-9]|[3-9]\d)\.\d+\.\d+$/.test(version)) throw new Error('Tham số nền tảng hoặc phiên bản Node.js không hợp lệ.');
  if (process.platform === 'win32') throw new Error('Hãy tạo bản ZIP trên macOS hoặc Linux để giữ quyền nhấp đúp của file .command. Người nhận vẫn chạy được trên Windows.');
  for (const command of ['zip', 'unzip', 'tar']) await run(command, ['--help']).catch(error => { if (error.code === 'ENOENT') throw new Error('Máy đóng gói cần công cụ ' + command); });
  await mkdir(output, { recursive: true });
  const cache = path.join(output, '.runtime-cache', version);
  await mkdir(cache, { recursive: true });
  const checksumResponse = await fetch(`https://nodejs.org/dist/${version}/SHASUMS256.txt`, { signal: AbortSignal.timeout(30000) });
  if (!checksumResponse.ok) throw new Error('Không đọc được SHA-256 chính thức của ' + version);
  const checksums = new Map((await checksumResponse.text()).split('\n').map(line => line.trim().split(/\s+/)).filter(parts => /^[\da-f]{64}$/.test(parts[0])).map(parts => [parts[1], parts[0]]));
  const platforms = platform === 'all' ? Object.keys(targets) : [platform];
  const selected = platforms.flatMap(item => targets[item]);
  const downloads = await Promise.all(selected.map(async target => {
    const filename = `node-${version}-${target}.${target.startsWith('win-') ? 'zip' : 'tar.gz'}`;
    return [target, await downloadChecked(filename, version, checksums, cache)];
  }));
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'noiradix-release-'));
  const archives = [];
  try {
    for (const item of platforms) {
      const buildDirectory = path.join(temporary, 'build-' + item);
      const runtimes = {};
      for (const [target, download] of downloads.filter(([target]) => targets[item].includes(target))) {
        const extraction = path.join(buildDirectory, target);
        await mkdir(extraction, { recursive: true });
        const prefix = `node-${version}-${target}`;
        const binary = target.startsWith('win-') ? 'node.exe' : 'bin/node';
        if (target.startsWith('win-')) await run('unzip', ['-q', download.output, prefix + '/' + binary, prefix + '/LICENSE', '-d', extraction]);
        else await run('tar', ['-xzf', download.output, '-C', extraction, prefix + '/' + binary, prefix + '/LICENSE']);
        runtimes[target] = { binary: path.join(extraction, prefix, binary), license: path.join(extraction, prefix, 'LICENSE'), archiveSha256: download.checksum };
      }
      const parent = path.join(buildDirectory, 'package');
      const name = 'NOIRADIX-Studio';
      await stagePortable({ destination: path.join(parent, name), platform: item, runtimes, version });
      const filename = `NOIRADIX-Studio-${item === 'macos' ? 'macOS' : 'Windows'}.zip`;
      const stagedZip = path.join(buildDirectory, filename);
      await run('zip', ['-q', '-r', '-9', stagedZip, name], { cwd: parent, maxBuffer: 1024 * 1024 });
      const destination = path.join(output, filename);
      await copyFile(stagedZip, destination);
      const checksum = await sha256(destination);
      await writeFile(destination + '.sha256', `${checksum}  ${filename}\n`);
      archives.push(destination);
      console.log('Đã tạo: ' + destination);
      await rm(buildDirectory, { recursive: true, force: true });
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return archives;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
    await packageStudio({ platform: option('--platform', 'all'), version: option('--node-version', nodeVersion), output: path.resolve(option('--output', path.join(projectRoot, 'dist'))) });
  } catch (error) { console.error('Không tạo được bản chia sẻ: ' + error.message); process.exitCode = 1; }
}
