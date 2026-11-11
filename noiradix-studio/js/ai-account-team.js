(function (root) {
  'use strict';
  root.AiAccountTeam = {
    mount({ container, monitor, isBusy, onChange, onOpen }) {
      container.innerHTML = `<h3>Làm việc bằng tài khoản đã đăng nhập</h3>
        <p class="ai-chat-note">Chọn model từ tài khoản của bạn. ChatGPT lập kế hoạch → Gemini vẽ → ChatGPT kiểm tra; nếu cần, Gemini sửa thêm một lượt.</p>
        <div class="ai-account-team-cards">
          <section class="ai-account-team-card"><h4>ChatGPT</h4><p data-account-status="chatgpt" role="status"></p>
            <p class="ai-chat-note">Lập kế hoạch và kiểm tra kết quả</p><label class="form-label" for="ai-team-chatgpt-model">Model ChatGPT</label>
            <select id="ai-team-chatgpt-model" class="modern-select full-width"></select><button data-account-open="chatgpt" class="btn btn-secondary" type="button">Kết nối ChatGPT</button></section>
          <section class="ai-account-team-card"><h4>Gemini · Google</h4><p data-account-status="google" role="status"></p>
            <p class="ai-chat-note">Vẽ pixel, tạo frame và chỉnh animation</p><label class="form-label" for="ai-team-google-model">Model Gemini</label>
            <select id="ai-team-google-model" class="modern-select full-width"></select><button data-account-open="google" class="btn btn-secondary" type="button">Kết nối Google</button></section>
        </div>
        <div class="ai-chat-actions"><button id="btn-ai-team-use" class="btn btn-primary" type="button">Dùng hai tài khoản cùng nhau</button></div>
        <p id="ai-team-status" class="ai-chat-note" role="status"></p><p id="ai-team-usage" class="ai-chat-note"></p>
        <p class="ai-chat-note">Mỗi tài khoản dùng hạn mức gói được nhà cung cấp cấp cho Studio. Hai tài khoản không cộng chung số dư. Không tự chuyển sang API key khi hết hạn mức.</p>
        <a class="ai-chat-note" href="docs/ACCOUNT_TEAM.md" target="_blank" rel="noopener noreferrer">Hướng dẫn phối hợp hai tài khoản ↗</a>`;
      let state = {}, pending = false;
      const find = selector => container.querySelector(selector);
      function picker(name, models, value) {
        const select = find('#ai-team-' + name + '-model'), choices = models || [];
        if (select.dataset.models !== JSON.stringify(choices)) {
          select.replaceChildren(...choices.map(item => new Option(item.name, item.id)));
          select.dataset.models = JSON.stringify(choices);
        }
        select.value = value || ''; select.disabled = isBusy() || pending || !choices.length;
      }
      function render() {
        const account = state.login || {}, google = state.google || {}, team = state.team || {};
        const chatgptReady = account.connected && account.sharing && account.models?.length;
        const ready = chatgptReady && google.connected;
        find('[data-account-status="chatgpt"]').textContent = chatgptReady ? 'Đã kết nối tài khoản' : account.connected ? 'Cần cấp quyền dùng gói' : 'Chưa đăng nhập';
        find('[data-account-status="google"]').textContent = google.connected ? 'Đã kết nối tài khoản' : ['starting', 'downloading', 'installing', 'signing_in'].includes(google.phase) ? 'Đang kết nối Google…' : 'Chưa kết nối';
        for (const name of ['chatgpt', 'google']) {
          const connected = name === 'chatgpt' ? account.connected : google.connected;
          find('[data-account-open="' + name + '"]').textContent = connected ? 'Quản lý tài khoản' : name === 'chatgpt' ? 'Kết nối ChatGPT' : 'Kết nối Google';
        }
        picker('chatgpt', account.models, account.model); picker('google', google.models, google.model);
        const use = find('#btn-ai-team-use'); use.disabled = isBusy() || pending || !chatgptReady || state.provider === 'accounts';
        use.textContent = state.provider === 'accounts' ? 'Đang dùng nhóm tài khoản' : 'Dùng hai tài khoản cùng nhau';
        find('#ai-team-status').textContent = state.provider === 'accounts' ? ready ? 'Nhóm sẵn sàng. Đóng cài đặt và nhập yêu cầu một lần trong chat.' :
          'Đã chọn nhóm. Hoàn tất kết nối cả hai tài khoản để bắt đầu.' : ready ? 'Hai tài khoản đã sẵn sàng. Bấm nút để dùng cùng nhau.' : 'Kết nối cả hai tài khoản để phối hợp. Bạn cũng có thể bấm dùng nhóm để khôi phục phiên Google đã lưu.';
        const usage = team.usage;
        find('#ai-team-usage').textContent = usage?.requests ? `ChatGPT đã dùng trong nhóm: ${(usage.inputTokens + usage.outputTokens).toLocaleString('vi-VN')} token đã được báo cáo · ${usage.requests} request` +
          (usage.unreportedRequests ? ` · ${usage.unreportedRequests} request chưa có số token.` : '.') + ' Gemini: ' + (google.contextUsage ? `${google.contextUsage.used.toLocaleString('vi-VN')} / ${google.contextUsage.size.toLocaleString('vi-VN')} token ngữ cảnh.` : 'chưa có số token sử dụng từ Google.') :
          'Token gói còn lại: chưa có dữ liệu từ nhà cung cấp. Studio chỉ hiển thị usage được báo cáo, không tự đoán số dư.';
        renderMonitor(team.workflow);
      }
      function renderMonitor(workflow) {
        monitor.classList.toggle('hidden', state.provider !== 'accounts'); monitor.replaceChildren();
        if (!workflow) return;
        const title = document.createElement('strong'); title.textContent = 'Nhóm tài khoản · ' + ({ Running: 'Đang chạy', Completed: 'Đã hoàn tất', Failed: 'Chưa hoàn tất', Cancelled: 'Đã dừng' }[workflow.status] || workflow.status); monitor.append(title);
        const list = document.createElement('ol');
        for (const stage of workflow.stages || []) {
          const item = document.createElement('li'); item.dataset.stage = stage.id; item.dataset.status = stage.status;
          item.textContent = stage.agent + ' · ' + stage.label + ' · ' + ({ Pending: 'Chờ', Running: 'Đang chạy', Completed: 'Xong', Skipped: 'Không cần', Failed: 'Lỗi', Cancelled: 'Đã dừng' }[stage.status] || stage.status);
          list.append(item);
        }
        monitor.append(list);
      }
      function apply(next) { state = next || state; render(); }
      function workflow(value) { state = { ...state, team: { ...state.team, workflow: value } }; renderMonitor(value); }
      async function action(url, body) {
        if (isBusy() || pending) return;
        pending = true; render(); let error;
        try {
          const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const result = await response.json();
          if (!response.ok) throw new Error(response.status === 404 ? 'Mở lại Studio bằng file khởi động để nạp nhóm tài khoản.' : result.error || 'Chưa cập nhật được nhóm tài khoản.');
          await onChange();
        } catch (problem) { error = problem.message; }
        finally { pending = false; render(); if (error) find('#ai-team-status').textContent = error; }
      }
      find('#btn-ai-team-use').addEventListener('click', () => action('/api/ai/source', { provider: 'accounts' }));
      find('#ai-team-chatgpt-model').addEventListener('change', event => action('/api/ai/auth/model', { model: event.target.value }));
      find('#ai-team-google-model').addEventListener('change', event => action('/api/ai/google/model', { model: event.target.value }));
      for (const button of container.querySelectorAll('[data-account-open]')) button.addEventListener('click', () => onOpen(button.dataset.accountOpen));
      render(); return { apply, render, workflow };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
