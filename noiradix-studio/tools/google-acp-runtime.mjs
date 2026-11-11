import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { mkdir, mkdtemp, readFile, writeFile, chmod, rename, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Pinned Google binaries from the ACP Registry. Do not run an arbitrary URL or
// silently replace a signed official runtime with a third-party wrapper.
export const googleAcpVersion = '1.4.5';
export const googleAcpDistributions = {
  'win32-x64': ['windows', 'windows-x86_64', 'd24f4c73c9f96d4f44384e281c855a56c72d8eaa9c5b0fad7ccb1635c6b63f50'],
  'win32-arm64': ['windows', 'windows-arm64', 'ab0a9aac8349e08ef289be6d16da8f89e3abe60eba5158032ef78c4a1220261c'],
  'darwin-x64': ['macos', 'darwin-x86_64', 'b39f3573c03b9acb9df028853f647527f1f3133f32bd77e78b796e48a205114a'],
  'darwin-arm64': ['macos', 'darwin-arm64', '886fff7767d08994ca39eb02c3d01a7532c7325a94aa33aaf52d52068733284f'],
  'linux-x64': ['linux', 'linux-x86_64', '923923a0d7dc8073f66cc6f78647a3107e3a7ee2b7e1a24df8b3927b5188013b'],
  'linux-arm64': ['linux', 'linux-arm64', '7d64246633ae094f67e3bbcd2d679e89048f91346d5339313336e7483f40f056']
};
export const googleDataDirectory = () => path.join(process.platform === 'win32' ? process.env.LOCALAPPDATA || os.tmpdir() :
  process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'NoiradixStudio', 'google-acp');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (root, target) => target.startsWith(path.resolve(root) + path.sep);

// ZIP support uses Node only: no PowerShell, unzip, Python or package manager
// dependency on the recipient's machine. Reject ZIP64, traversal and symlinks.
export async function extractGoogleZip(bytes, destination) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { eocd = i; break; }
  }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) || bytes.readUInt16LE(eocd + 6)) throw new Error('Gói Google ACP không phải ZIP được hỗ trợ.');
  const entries = bytes.readUInt16LE(eocd + 10), directory = bytes.readUInt32LE(eocd + 16);
  if (entries === 65535 || directory === 0xffffffff || entries > 10000) throw new Error('Gói Google ACP vượt giới hạn.');
  let offset = directory, total = 0;
  const files = new Map();
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Mục lục ZIP không hợp lệ.');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
    const nameSize = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const mode = bytes.readUInt32LE(offset + 38) >>> 16, local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString('utf8');
    offset += 46 + nameSize + extra + comment;
    if (!name || /[\\:\0]/.test(name) || name.startsWith('/') || name.split('/').includes('..') || (mode & 0xf000) === 0xa000 || flags & 1) throw new Error('Đường dẫn trong gói Google ACP không an toàn.');
    const target = path.resolve(destination, name);
    if (!within(destination, target)) throw new Error('Đường dẫn ZIP nằm ngoài thư mục tải.');
    if (name.endsWith('/')) { await mkdir(target, { recursive: true }); continue; }
    total += size;
    if (total > 1024 * 1024 * 1024 || size > 512 * 1024 * 1024 || local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('Dữ liệu ZIP vượt giới hạn hoặc hỏng.');
    const dataOffset = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (dataOffset + compressed > directory || ![0, 8].includes(method)) throw new Error('Dữ liệu nén Google ACP không hợp lệ.');
    const packed = bytes.subarray(dataOffset, dataOffset + compressed);
    const content = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, size) });
    if (content.length !== size || files.has(name)) throw new Error('Kích thước/tên file ZIP không hợp lệ.');
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, { flag: 'wx', mode: mode & 0o777 || 0o644 });
    files.set(name, hash(content));
  }
  return Object.fromEntries(files);
}

export async function ensureGoogleRuntime({ directory = googleDataDirectory(), platform = process.platform, arch = process.arch,
  fetchImpl = fetch, onProgress = () => {}, signal, distribution = googleAcpDistributions[platform + '-' + arch] } = {}) {
  directory = path.resolve(directory);
  if (!distribution) throw new Error('Google ACP chưa hỗ trợ hệ điều hành/kiến trúc máy này.');
  const [folder, suffix, checksum] = distribution;
  const destination = path.join(directory, googleAcpVersion + '-' + suffix + '-' + checksum.slice(0, 8));
  const executableName = platform === 'win32' ? 'agy_acp_server.exe' : 'agy_acp_server.par';
  const executable = path.join(destination, executableName);
  try {
    const manifest = JSON.parse(await readFile(path.join(destination, 'verified.json'), 'utf8'));
    if (manifest.archiveHash !== checksum || !Object.keys(manifest.files).length) throw new Error('Cache chưa xác minh.');
    for (const [name, digest] of Object.entries(manifest.files)) {
      const file = path.resolve(destination, name);
      if (!within(destination, file) || (await lstat(file)).isSymbolicLink() || hash(await readFile(file)) !== digest) throw new Error('Cache Google ACP đã thay đổi.');
    }
    if (!manifest.files[executableName]) throw new Error('Thiếu bộ kết nối.');
    return { executable, args: platform === 'linux' ? ['--uid='] : [], cached: true };
  } catch { /* A partial/corrupt cache is never executed. Download a fresh copy. */ }
  await mkdir(directory, { recursive: true });
  const stage = await mkdtemp(path.join(directory, 'download-'));
  try {
    onProgress({ phase: 'downloading', bytes: 0, total: null });
    const url = `https://dl.google.com/agy-extensions/releases/${folder}/agy-acp-server-${googleAcpVersion}-${suffix}.zip`;
    const response = await fetchImpl(url, { signal });
    if (!response.ok || response.url && new URL(response.url).origin !== 'https://dl.google.com') throw new Error('Không tải được bộ kết nối từ Google. Kiểm tra mạng rồi thử lại.');
    const total = Number(response.headers.get('content-length')) || null;
    if (total > 512 * 1024 * 1024) throw new Error('Gói Google ACP quá lớn.');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length; if (size > 512 * 1024 * 1024) throw new Error('Gói Google ACP quá lớn.');
      chunks.push(chunk); onProgress({ phase: 'downloading', bytes: size, total });
    }
    const archive = Buffer.concat(chunks);
    if (hash(archive) !== checksum) throw new Error('Checksum bộ kết nối Google không khớp. Đã dừng trước khi chạy.');
    onProgress({ phase: 'installing', bytes: size, total: size });
    const files = await extractGoogleZip(archive, stage);
    if (!files[executableName]) throw new Error('Gói Google không có bộ kết nối cho máy này.');
    await chmod(path.join(stage, executableName), 0o755);
    await writeFile(path.join(stage, 'verified.json'), JSON.stringify({ archiveHash: checksum, files }));
    // Verified absolute targets stay inside the private Google cache directory.
    if (!within(directory, destination)) throw new Error('Cache nằm ngoài thư mục cho phép.');
    await rm(destination, { recursive: true, force: true });
    await rename(stage, destination);
    return { executable, args: platform === 'linux' ? ['--uid='] : [], cached: false };
  } finally {
    if (path.dirname(stage) !== path.resolve(directory)) throw new Error('Thư mục tải không hợp lệ.');
    await rm(stage, { recursive: true, force: true });
  }
}
