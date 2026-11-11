import { spawn } from 'node:child_process';

export function acpProblem(error) {
  const value = String(error?.message || '');
  const message = error?.code === -32000 || /auth.*required|not authenticated|login required/i.test(value) ? 'Google yêu cầu đăng nhập lại. Mở Cài đặt AI → Google để kết nối.' :
    /quota|rate.limit|resource.exhaust|credit|usage.limit/i.test(value) ? 'Google báo đã chạm hạn mức của tài khoản/model. Kiểm tra hạn mức trong Google Antigravity; Studio không tự chuyển sang API trả phí.' :
    /model|entitlement|permission.denied/i.test(value) ? 'Tài khoản Google chưa được cấp quyền dùng model này. Chọn model khác trong Cài đặt AI → Google.' :
    'Bộ kết nối Google chưa hoàn tất yêu cầu. Kiểm tra đăng nhập và kết nối mạng rồi thử lại.';
  return Object.assign(new Error(message), { status: 502 });
}

/** ACP v1 JSON-RPC over stdio. Google owns sign-in and all account credentials. */
export class GoogleAcpClient {
  constructor({ executable, args = [], cwd, spawnImpl = spawn, onUpdate = () => {}, onPermission = async () => ({ outcome: { outcome: 'cancelled' } }), onExit = () => {} }) {
    this.pending = new Map(); this.next = 0; this.closed = false; this.buffer = '';
    this.stopped = new Promise(resolve => { this.resolveStopped = resolve; });
    // Do not accidentally change a subscription login into billable API-key or
    // cloud-credential authentication inherited from the Studio environment.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)));
    this.child = spawnImpl(executable, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    this.child.on('error', () => this.fail(Object.assign(new Error('Không chạy được bộ kết nối Google trên máy này.'), { status: 503 })));
    this.child.on('exit', () => { this.fail(Object.assign(new Error('Bộ kết nối Google đã dừng. Bấm Đăng nhập Google để kết nối lại.'), { status: 503 })); onExit(); });
    this.child.stdin.on('error', () => this.fail(Object.assign(new Error('Kết nối Google đã đóng.'), { status: 503 })));
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      if (this.closed) return;
      this.buffer += chunk;
      if (this.buffer.length > 8000000) { this.close(); return; }
      let line;
      while ((line = this.buffer.indexOf('\n')) >= 0) {
        const text = this.buffer.slice(0, line); this.buffer = this.buffer.slice(line + 1);
        if (!text.trim()) continue;
        let message;
        try { message = JSON.parse(text); } catch { this.close(); return; }
        if (message.jsonrpc !== '2.0') { this.close(); return; }
        if (message.method) {
          if (message.id !== undefined) {
            Promise.resolve(message.method === 'session/request_permission' ? onPermission(message.params) :
              Promise.reject(Object.assign(new Error('Unsupported ACP client method'), { rpcCode: -32601 })))
              .then(result => this.write({ jsonrpc: '2.0', id: message.id, result }))
              .catch(error => this.write({ jsonrpc: '2.0', id: message.id, error: { code: error.rpcCode || -32603, message: 'Studio does not provide this operation.' } }));
          } else if (message.method === 'session/update') onUpdate(message.params);
        } else if (message.id !== undefined) {
          const item = this.pending.get(message.id); if (!item) continue;
          this.pending.delete(message.id); clearTimeout(item.timer);
          if (message.error) item.reject(acpProblem(message.error)); else item.resolve(message.result);
        }
      }
    });
  }
  write(value) { if (!this.closed) this.child.stdin.write(JSON.stringify(value) + '\n'); }
  call(method, params, timeout = 120000) {
    if (this.closed) return Promise.reject(Object.assign(new Error('Bộ kết nối Google chưa chạy.'), { status: 503 }));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error('Google mất quá lâu để phản hồi. Thử kết nối lại.'), { status: 504 })); }, timeout);
      this.pending.set(id, { resolve, reject, timer }); this.write({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method, params) { this.write({ jsonrpc: '2.0', method, params }); }
  fail(error) {
    if (this.closed) return this.stopped;
    this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
    let finished = false, stopTimer;
    const finishedStop = () => {
      if (finished) return; finished = true; clearTimeout(stopTimer);
      this.child.stdin.destroy(); this.child.stdout.destroy(); this.child.unref(); this.resolveStopped();
    };
    if (process.platform === 'win32' && this.child.pid) {
      // Google's packaged runtime can spawn a worker. Stop only this owned
      // process tree, otherwise its inherited pipes keep Node alive on exit.
      const killer = spawn('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
      killer.once('error', () => { this.child.kill(); finishedStop(); });
      killer.once('exit', code => { if (code) this.child.kill(); finishedStop(); }); killer.unref();
      // Keep stdin open until the tree is terminated. Sending EOF first lets a
      // launcher exit and orphan its worker before taskkill can discover it.
      stopTimer = setTimeout(() => { this.child.kill(); finishedStop(); }, 5000);
    } else {
      try { process.kill(-this.child.pid, 'SIGTERM'); } catch { this.child.kill(); }
      finishedStop();
    }
    return this.stopped;
  }
  close() { return this.fail(Object.assign(new Error('Đã ngắt kết nối Google.'), { status: 499 })); }
}
