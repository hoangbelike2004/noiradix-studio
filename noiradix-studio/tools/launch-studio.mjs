import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStudioServer, studioInstanceId, studioBuildId } from './studio-server.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function browserCommand(url, platform = process.platform) {
  if (platform === 'win32') return ['rundll32.exe', ['url.dll,FileProtocolHandler', url]];
  if (platform === 'darwin') return ['/usr/bin/open', [url]];
  return ['xdg-open', [url]];
}

export function openStudioBrowser(url, log = console.log) {
  const [command, args] = browserCommand(url);
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', () => log('Không tự mở được trình duyệt. Hãy mở địa chỉ ở trên bằng Chrome hoặc Edge.'));
  child.unref();
}

/** Bind before opening the browser. Reuse this copy only; never kill a busy port. */
export async function launchStudio({ port = 8080, attempts = 20, rootDir = projectRoot, openBrowser = true,
  open = openStudioBrowser, log = console.log, serverOptions = {} } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(attempts) || attempts < 1 || attempts > 100) throw new Error('Cổng localhost không hợp lệ.');
  const instance = studioInstanceId(rootDir);
  for (let candidate = port; candidate < port + attempts && candidate <= 65535; candidate++) {
    const url = `http://127.0.0.1:${candidate}/`;
    const server = createStudioServer({ ...serverOptions, rootDir });
    try {
      await new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError); server.once('listening', onListening);
        server.listen(candidate, '127.0.0.1');
      });
      log(`\nNOIRADIX Studio đã mở: ${url}`);
      log('Giữ cửa sổ này mở khi dùng Studio. Nhấn Ctrl+C hoặc đóng cửa sổ để tắt.\n');
      if (openBrowser) open(url, log);
      return { server, url, reused: false };
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      try {
        const response = await fetch(url + 'api/studio/info', { signal: AbortSignal.timeout(800), redirect: 'error' });
        const info = response.ok ? await response.json() : null;
        if (info?.application === 'noiradix-studio' && info.instance === instance && info.build === studioBuildId) {
          log(`Studio đang chạy: ${url}`);
          if (openBrowser) open(url, log);
          return { server: null, url, reused: true };
        }
        if (info?.application === 'noiradix-studio' && info.instance === instance) log('Studio ở cổng ' + candidate + ' đang dùng máy chủ cũ. Giữ nguyên phiên đó và mở bản cập nhật ở cổng khác.');
      } catch { /* A different local service owns this port; try the next one. */ }
    }
  }
  throw new Error('Chưa tìm được cổng localhost trống. Hãy đóng các bản Studio khác rồi mở lại.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const envFile = path.join(projectRoot, '.env.local');
    if (existsSync(envFile)) process.loadEnvFile(envFile);
    const portIndex = process.argv.indexOf('--port');
    const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 8080;
    const result = await launchStudio({ port, openBrowser: !process.argv.includes('--no-open') });
    if (result.server) {
      const stop = () => { result.server.closeAllConnections(); result.server.close(); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop); process.once('SIGHUP', stop);
    }
  } catch (error) {
    console.error('Không mở được Studio: ' + (error.code === 'EACCES' ? 'Máy chưa cho phép mở cổng localhost.' : error.message));
    process.exitCode = 1;
  }
}
