(function (root) {
  'use strict';
  root.AiGoogleSettings = {
    mount({ isBusy, onChange }) {
      const el = id => document.getElementById(id);
      let state = { phase: 'disconnected', connected: false, selected: false, models: [] }, pending = false, poll = null;
      const transient = () => ['downloading', 'installing', 'starting', 'signing_in'].includes(state.phase);
      function render() {
        const blocked = isBusy() || pending, working = transient();
        const labels = { disconnected: 'Chưa kết nối Google.', downloading: 'Đang tải bộ kết nối Google…', installing: 'Đang kiểm tra và chuẩn bị bộ kết nối…',
          starting: 'Đang khởi động kết nối Google…', signing_in: 'Hoàn tất đăng nhập Google trong trình duyệt, rồi quay lại Studio.',
          connected: state.selected ? 'Đã kết nối · Google đang được dùng cho chat.' : 'Đã kết nối Google · hiện đang chọn kết nối AI khác cho chat.', error: state.error || 'Chưa kết nối được Google.' };
        let label = labels[state.phase] || labels.disconnected;
        if (state.phase === 'downloading' && state.progress?.bytes) label += ' ' + (state.progress.bytes / 1048576).toFixed(1) + ' MB';
        el('ai-google-status').textContent = label;
        const progress = el('ai-google-download'); progress.classList.toggle('hidden', !['downloading', 'installing'].includes(state.phase));
        if (state.progress?.total) { progress.max = state.progress.total; progress.value = state.progress.bytes; } else progress.removeAttribute('value');
        el('btn-ai-google-login').classList.toggle('hidden', working || state.connected);
        el('btn-ai-google-login').textContent = state.phase === 'error' ? 'Thử kết nối Google lại' : 'Đăng nhập Google';
        el('btn-ai-google-cancel').classList.toggle('hidden', !working);
        el('btn-ai-google-select').classList.toggle('hidden', !state.connected || state.selected);
        el('btn-ai-google-api').classList.toggle('hidden', !state.selected);
        el('btn-ai-google-disconnect').classList.toggle('hidden', !state.connected);
        for (const id of ['login', 'cancel', 'select', 'api', 'disconnect']) el('btn-ai-google-' + id).disabled = blocked;
        const picker = el('ai-google-model');
        const models = state.models || [], signature = JSON.stringify(models);
        if (picker.dataset.models !== signature) { picker.replaceChildren(...models.map(item => new Option(item.name, item.id))); picker.dataset.models = signature; }
        picker.value = state.model || ''; picker.disabled = blocked;
        el('ai-google-model-controls').classList.toggle('hidden', !state.connected || !models.length);
        const usage = state.contextUsage;
        el('ai-google-usage').textContent = usage ? `Ngữ cảnh: ${usage.used.toLocaleString('vi-VN')} / ${usage.size.toLocaleString('vi-VN')} token. Đây là cửa sổ ngữ cảnh, không phải hạn mức gói còn lại.` :
          'Hạn mức gói còn lại: chưa có dữ liệu từ Google. Studio không tự chuyển sang API trả phí.';
        if (working && !poll) poll = setInterval(refresh, 1500);
        if (!working && poll) { clearInterval(poll); poll = null; }
      }
      function apply(next) { state = next || state; render(); }
      async function refresh() {
        try {
          const response = await fetch('/api/ai/google/status', { cache: 'no-store' });
          if (!response.ok) return;
          const next = await response.json(), changed = next.phase !== state.phase || next.connected !== state.connected || next.selected !== state.selected;
          apply(next); if (changed) await onChange();
        } catch { /* Main connection status explains a missing local server. */ }
      }
      async function action(name, body = {}) {
        if (isBusy() || pending) return;
        pending = true; render();
        let failure;
        try {
          const response = await fetch('/api/ai/google/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const result = await response.json();
          if (!response.ok) throw new Error(response.status === 404 ? 'Máy chủ Studio đang dùng bản cũ. Mở lại Studio bằng file khởi động để nạp đăng nhập Google.' : result.error || 'Chưa kết nối được Google.');
          apply(result); await onChange();
        } catch (error) { failure = error.message; }
        finally { pending = false; render(); if (failure) el('ai-google-status').textContent = failure; }
      }
      el('btn-ai-google-login').addEventListener('click', () => action('start'));
      el('btn-ai-google-cancel').addEventListener('click', () => action('cancel'));
      el('btn-ai-google-disconnect').addEventListener('click', () => action('disconnect'));
      el('btn-ai-google-select').addEventListener('click', () => action('select', { selected: true }));
      el('btn-ai-google-api').addEventListener('click', () => action('select', { selected: false }));
      el('ai-google-model').addEventListener('change', event => action('model', { model: event.target.value }));
      render(); return { apply, render, refresh };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
