(function (root) {
  'use strict';
  // Suggestions, not a claim of access for the user's API key. Keep custom IDs
  // and saved models available as providers release or retire models.
  const modelChoices = {
    openai: [['gpt-6.1-sol', 'GPT-6.1 Sol'], ['gpt-6-astra', 'GPT-6 Astra'], ['gpt-6.1-terra', 'GPT-6.1 Terra'], ['gpt-6-luna', 'GPT-6 Luna']],
    gemini: [['gemini-4-argon', 'Gemini 4 Argon'], ['gemini-3.8-flash', 'Gemini 3.8 Flash']]
  };
  const customModel = '__custom__';
  root.AiAgentManager = {
    mount({ container, monitor, isBusy, onChange }) {
      container.innerHTML = `<div class="ai-agent-settings-grid">
        <section class="ai-agent-list-section" aria-labelledby="ai-agent-list-title">
          <h3 id="ai-agent-list-title">AI đã thêm <span data-agent-count class="ai-agent-count">0</span></h3>
          <p class="ai-chat-note">Chọn Sửa để thay đổi kết nối hoặc chọn AI điều phối cho nhóm.</p>
          <p class="ai-chat-note">Token tính từ lúc máy chủ khởi động, chỉ gồm yêu cầu của Studio. Số còn lại dựa trên giới hạn bạn tự đặt; số dư API thật xem tại Billing. Nhiều AI cùng tài khoản có thể dùng chung số dư.</p>
          <div data-agents class="ai-agent-list"></div>
        </section>
        <section class="ai-agent-form-section" aria-labelledby="ai-agent-form-title">
        <h3 id="ai-agent-form-title">Thêm AI</h3>
        <p class="ai-chat-note">Chọn nhà cung cấp, model và dán API key để thêm vào nhóm.</p>
        <form data-agent-form autocomplete="off">
          <label class="form-label">Tên AI<input name="name" class="modern-input full-width" required maxlength="100" placeholder="ChatGPT 1"></label>
          <label class="form-label">Nhà cung cấp<select name="provider" class="modern-select full-width"><option value="openai">OpenAI API</option><option value="gemini">Gemini API</option></select></label>
          <label class="form-label">Model<select name="model" class="modern-select full-width" required aria-describedby="ai-agent-model-hint"></select></label>
          <label class="form-label hidden" data-custom-model>Model khác<input name="customModel" class="modern-input full-width" maxlength="120" placeholder="Nhập ID model khác" disabled></label>
          <p id="ai-agent-model-hint" class="ai-chat-note"></p>
          <label class="form-label">API key<input name="apiKey" type="password" class="modern-input full-width" autocomplete="off" spellcheck="false" maxlength="4096" placeholder="Dán toàn bộ key bằng nút Copy; để trống khi giữ key cũ"></label>
          <p class="ai-chat-note"><a data-key-help href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">Lấy OpenAI API key ↗</a></p>
          <label class="form-label">Vai trò<select name="role" class="modern-select full-width"><option value="auto">Tự động</option><option value="orchestrator">Orchestrator</option><option value="designer">Character Designer (tư vấn)</option><option value="planner">Animation Planner</option><option value="generator">Frame Generator (công cụ pixel)</option><option value="reviewer">Frame Reviewer</option><option value="refiner">Pixel Refinement (công cụ pixel)</option></select></label>
          <label class="form-label">Giới hạn token trong Studio<input name="tokens" type="number" min="0" step="1" max="9007199254740991" class="modern-input full-width" placeholder="Chưa đặt giới hạn" aria-describedby="ai-agent-token-hint"></label>
          <p id="ai-agent-token-hint" class="ai-chat-note">Tổng input + output cho AI này trong phiên máy chủ. Để trống nếu không giới hạn; nhập 0 để chặn. Đây không phải số token được nhà cung cấp cấp. Studio có thể dừng sớm để dành đủ token cho yêu cầu tiếp theo.</p>
          <details class="ai-agent-advanced"><summary>Cài đặt nâng cao · khả năng, giới hạn và chi phí</summary>
          <label><input name="tools" type="checkbox" checked> Hỗ trợ gọi công cụ</label>
          <label><input name="vision" type="checkbox" checked> Hỗ trợ xem ảnh</label>
          <p class="ai-chat-note">Đặt khả năng theo model thực tế. Hình được dựng bằng công cụ pixel xác định của editor; không giả định model văn bản có API sinh ảnh.</p>
          <div class="ai-agent-numbers">
            <label>Giới hạn request<input name="requests" type="number" min="0" step="1" class="modern-input" placeholder="Không giới hạn"></label>
            <label>Ngân sách USD<input name="costUSD" type="number" min="0" step="any" class="modern-input" placeholder="Không giới hạn"></label>
            <label>USD / 1M input<input name="inputPrice" type="number" min="0" step="any" class="modern-input" placeholder="Chưa có giá"></label>
            <label>USD / 1M cached<input name="cachedPrice" type="number" min="0" step="any" class="modern-input" placeholder="Chưa có giá"></label>
            <label>USD / 1M output<input name="outputPrice" type="number" min="0" step="any" class="modern-input" placeholder="Chưa có giá"></label>
          </div>
          </details>
          <div class="ai-chat-actions"><button class="btn btn-primary" type="submit">Lưu AI</button><button data-new class="btn btn-secondary" type="button">Thêm AI khác</button></div>
          <details class="ai-agent-advanced" data-import-options><summary>Thêm từ kết nối đã có</summary>
          <button data-import class="btn btn-secondary" type="button">Thêm tài khoản ChatGPT đang chọn</button>
          <button data-import-api class="btn btn-secondary" type="button">Thêm kết nối OpenAI API hiện tại</button>
          </details>
        </form>
        <p data-error class="ai-chat-note" role="status"></p>
        <p class="ai-chat-note">Key chỉ giữ trong bộ nhớ máy chủ đến khi tắt.</p>
        </section>
        </div>
        <details class="ai-agent-advanced ai-agent-policy"><summary>Giới hạn mỗi workflow</summary><div class="ai-agent-numbers">
          <label>Phân công<select data-policy="assignment" class="modern-select"><option value="auto">Tự động</option><option value="manual">Theo vai trò thủ công</option></select></label>
          <label>Request tối đa<input data-policy="maxRequests" type="number" value="32" min="1" max="64" class="modern-input"></label>
          <label>Output / request<input data-policy="maxOutputTokens" type="number" value="10000" min="256" max="16000" class="modern-input"></label>
          <label>Retry tối đa<input data-policy="maxRetries" type="number" value="1" min="0" max="2" class="modern-input"></label>
          <label>Vòng sửa lỗi<input data-policy="maxRepairRounds" type="number" value="2" min="0" max="8" class="modern-input"></label>
          <label>Token tối đa<input data-policy="maxTokens" type="number" min="0" class="modern-input" placeholder="Không giới hạn"></label>
          <label>Ngân sách USD<input data-policy="maxCostUSD" type="number" min="0" step="any" class="modern-input" placeholder="Cần giá model"></label>
        </div><label><input data-policy="allowFallback" type="checkbox" checked> Cho phép chuyển sang AI tương thích khi mất kết nối</label>
        <label><input data-policy="optimized" type="checkbox" checked> Tối ưu context (bỏ chọn để đo đối chứng)</label>
        <p class="ai-chat-note">Giới hạn token/chi phí kiểm tra trước request bằng ước tính bảo thủ, rồi cập nhật usage thực tế. Giá do bạn nhập; không phải cam kết hóa đơn của provider. Giới hạn AI tính từ lúc khởi động máy chủ.</p></details>
      `;
      const form = container.querySelector('[data-agent-form]'), list = container.querySelector('[data-agents]'), error = container.querySelector('[data-error]');
      const fields = form.elements;
      let state = { agents: [], workflows: [], usage: [], orchestratorId: null }, editing = null, pending = false;
      const text = (tag, value, className) => { const item = document.createElement(tag); item.textContent = value; if (className) item.className = className; return item; };
      const money = usage => usage.unpricedRequests ? 'chưa đủ giá' : '$' + usage.costUSD.toFixed(5);
      const number = value => value == null ? 'Chưa xác định' : value.toLocaleString('vi-VN');
      const externalLink = (label, href) => {
        const link = text('a', label); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
      };
      const button = (label, action) => {
        const item = text('button', label, 'btn btn-xs btn-secondary'); item.type = 'button'; item.disabled = isBusy() || pending;
        item.addEventListener('click', action); return item;
      };
      const numeric = name => fields[name].value === '' ? null : Number(fields[name].value);
      function modelValue() { return fields.model.value === customModel ? fields.customModel.value.trim() : fields.model.value; }
      function modelControls() {
        const custom = fields.model.value === customModel, gemini = fields.provider.value === 'gemini';
        container.querySelector('[data-custom-model]').classList.toggle('hidden', !custom);
        fields.customModel.required = custom; fields.customModel.disabled = !custom || isBusy() || pending;
        const id = modelValue();
        fields.customModel.setCustomValidity(custom && id && !/^[\w.:-]{1,120}$/.test(id) ? 'ID model chỉ gồm chữ, số, dấu chấm, gạch nối, gạch dưới hoặc dấu hai chấm.' : '');
        container.querySelector('#ai-agent-model-hint').textContent = id ? 'Model đã chọn: ' + id + '. Quyền truy cập phụ thuộc tài khoản API của bạn.' :
          gemini ? 'Chọn Gemini 4 Argon hoặc Gemini 3.8 Flash trong danh sách.' : 'Chọn model cho API key. Khi thêm tài khoản ChatGPT đã đăng nhập, có thể để trống để dùng model hiện tại.';
        container.querySelector('[data-import]').classList.toggle('hidden', gemini);
        container.querySelector('[data-import-api]').classList.toggle('hidden', gemini);
        container.querySelector('[data-import-options]').classList.toggle('hidden', gemini);
        const keyHelp = container.querySelector('[data-key-help]');
        keyHelp.href = gemini ? 'https://aistudio.google.com/apikey' : 'https://platform.openai.com/api-keys';
        keyHelp.textContent = gemini ? 'Lấy Gemini API key ↗' : 'Lấy OpenAI API key ↗';
      }
      function populateModels(selected = '') {
        fields.model.replaceChildren(new Option('Chọn model…', ''));
        for (const [id, label] of modelChoices[fields.provider.value]) fields.model.add(new Option(label, id));
        if (selected && !modelChoices[fields.provider.value].some(([id]) => id === selected)) fields.model.add(new Option('Model đã lưu · ' + selected, selected));
        fields.model.add(new Option('Model khác…', customModel));
        fields.model.value = selected; fields.customModel.value = ''; modelControls();
      }
      fields.provider.addEventListener('change', () => populateModels());
      fields.model.addEventListener('change', () => { modelControls(); if (fields.model.value === customModel) fields.customModel.focus(); });
      fields.customModel.addEventListener('input', modelControls);
      function renderUsage(agent, row) {
        const balance = root.AiAgentUsage.summarize(agent), usage = agent.usage;
        const box = document.createElement('div'); box.className = 'ai-agent-token-usage'; box.dataset.tokenStatus = balance.status;
        if (balance.exhausted || balance.low) box.classList.add('ai-agent-token-warning');
        const stats = document.createElement('dl'); stats.className = 'ai-agent-token-stats';
        const stat = (label, value, marker) => {
          const group = document.createElement('div'); const amount = text('dd', value); amount.dataset[marker] = '';
          group.append(text('dt', label), amount); stats.append(group);
        };
        stat('Token đã dùng' + (balance.complete ? '' : ' (chưa đủ)'), number(balance.totalTokens), 'tokensUsed');
        stat('Còn lại trong Studio', balance.status === 'not_set' ? 'Chưa đặt giới hạn' : balance.status === 'unsupported' ? 'Xem gói ChatGPT' : number(balance.remainingTokens), 'tokensRemaining');
        box.append(stats);
        box.append(text('p', `Input ${number(usage.inputTokens)} · Output ${number(usage.outputTokens)} · Cache ${number(usage.cachedTokens)} (đã nằm trong input)`, 'ai-chat-note'));
        if (balance.status === 'known') {
          const progress = document.createElement('progress'); progress.max = 1; progress.value = balance.fractionUsed;
          progress.setAttribute('aria-label', 'Token đã dùng so với giới hạn trong Studio'); box.append(progress);
          box.append(text('p', `Giới hạn do bạn đặt: ${number(balance.limit)} token` + (balance.exhausted ? ' · Đã hết giới hạn trong Studio.' : balance.low ? ' · Còn tối đa 10%.' : ''), 'ai-chat-note'));
        } else if (balance.status === 'unreported') {
          box.append(text('p', `${usage.unreportedRequests || 0} request chưa có đủ usage. Chưa xác định token còn lại; Studio sẽ chặn yêu cầu có giới hạn để bảo vệ ngân sách.`, 'ai-chat-note'));
        } else if (balance.status === 'unsupported') {
          box.append(text('p', 'Phiên đăng nhập ChatGPT không hỗ trợ giới hạn token riêng trong Studio. Hạn mức của gói xem trong ChatGPT.', 'ai-chat-note'));
        }
        if (agent.authMethod !== 'chatgpt_oauth') {
          box.append(button(balance.limit === null ? 'Đặt giới hạn token' : 'Đổi giới hạn token', () => { edit(agent); fields.tokens.focus(); }));
        }
        row.append(box);
        row.append(text('p', `${usage.requests} requests · Chi phí theo giá đã nhập: ${money(usage)}`, 'ai-chat-note'));
        const links = document.createElement('div'); links.className = 'ai-agent-billing-links';
        if (agent.authMethod === 'chatgpt_oauth') links.append(externalLink('Hạn mức ChatGPT ↗', 'https://chatgpt.com/settings/usage'));
        else {
          const gemini = agent.provider === 'gemini';
          links.append(externalLink('Usage ↗', gemini ? 'https://aistudio.google.com/usage' : 'https://platform.openai.com/usage'),
            externalLink('Số dư API / Billing ↗', gemini ? 'https://aistudio.google.com/billing' : 'https://platform.openai.com/settings/organization/billing/overview'));
        }
        row.append(links);
      }
      function render() {
        container.querySelector('[data-agent-count]').textContent = String(state.agents.length);
        container.querySelector('#ai-agent-form-title').textContent = editing ? 'Sửa AI' : 'Thêm AI';
        list.replaceChildren();
        for (const agent of state.agents) {
          const row = document.createElement('article'); row.className = 'ai-agent-card'; row.dataset.agentId = agent.id;
          row.append(text('strong', agent.name + (agent.id === state.orchestratorId ? ' · Orchestrator' : '')));
          row.append(text('p', `${agent.provider} · ${agent.model} · ${agent.enabled ? agent.status : 'disabled'} · ${agent.role}`, 'ai-chat-note'));
          const active = state.workflows.flatMap(item => item.tasks).find(item => item.agentId === agent.id && item.status === 'Running');
          if (active) row.append(text('p', active.goal, 'ai-chat-note'));
          renderUsage(agent, row);
          const controls = document.createElement('div'); controls.className = 'ai-chat-actions';
          controls.append(button('Sửa', () => edit(agent)), button(agent.enabled ? 'Tắt' : 'Bật', () => mutate('save', { id: agent.id, enabled: !agent.enabled })),
            button('Điều phối', () => mutate('orchestrator', { id: agent.id })), button('Xóa', () => mutate('remove', { id: agent.id })));
          row.append(controls); list.append(row);
        }
        if (!state.agents.length) list.append(text('p', 'Chưa có AI trong nhóm. Điền form Thêm AI để bắt đầu.', 'ai-agent-empty'));
        for (const item of form.querySelectorAll('input, select, button')) item.disabled = isBusy() || pending;
        if (editing && state.agents.find(item => item.id === editing)?.authMethod === 'chatgpt_oauth') { fields.provider.disabled = true; fields.apiKey.disabled = true; }
        const oauth = editing && state.agents.find(item => item.id === editing)?.authMethod === 'chatgpt_oauth';
        fields.tokens.disabled = Boolean(oauth) || isBusy() || pending;
        container.querySelector('#ai-agent-token-hint').textContent = oauth ? 'Giới hạn token riêng không áp dụng cho phiên ChatGPT; xem hạn mức tại ChatGPT.' :
          'Tổng input + output cho AI này trong phiên máy chủ. Để trống nếu không giới hạn; nhập 0 để chặn. Đây không phải số token được nhà cung cấp cấp. Studio có thể dừng sớm để dành đủ token cho yêu cầu tiếp theo.';
        modelControls();
        renderMonitor();
      }
      function renderMonitor() {
        monitor.replaceChildren();
        const recent = state.workflows.slice(-1)[0];
        if (!recent) return;
        const details = document.createElement('details'); details.open = ['Running', 'Waiting'].includes(recent.status);
        details.append(text('summary', `Workflow · ${recent.mode} · ${recent.status}`));
        const usage = recent.usage;
        details.append(text('p', `${usage.requests} requests · ${usage.inputTokens} in / ${usage.outputTokens} out / ${usage.cachedTokens} cached · ${money(usage)} · ${(recent.elapsedMs / 1000).toFixed(1)}s · cache ${(usage.cacheHitRate * 100).toFixed(0)}%`, 'ai-chat-note'));
        if (usage.unreportedRequests) details.append(text('p', `${usage.unreportedRequests} request chưa có usage từ provider; tổng token chưa đầy đủ.`, 'ai-chat-note'));
        const steps = document.createElement('ol'); steps.className = 'ai-agent-workflow';
        for (const task of recent.tasks) {
          const name = state.agents.find(item => item.id === task.agentId)?.name || task.model;
          const step = text('li', `${task.status} · ${name} · ${task.goal}`);
          if (task.error) step.append(text('p', task.error));
          steps.append(step);
        }
        details.append(steps); monitor.append(details);
        const completed = state.workflows.filter(item => item.status === 'Completed');
        if (completed.length) {
          const table = document.createElement('table'); table.className = 'ai-agent-comparison'; table.append(text('caption', 'Lượt đã hoàn tất trong phiên máy chủ'));
          const header = document.createElement('tr'); for (const label of ['Chế độ', 'Số lượt', 'Request TB', 'Token TB']) header.append(text('th', label)); table.append(header);
          for (const mode of ['single', 'multi']) for (const optimized of [false, true]) {
            const rows = completed.filter(item => item.mode === mode && item.optimized === optimized); if (!rows.length) continue;
            const row = document.createElement('tr');
            for (const value of [mode + (optimized ? ' · tối ưu' : ' · đối chứng'), rows.length, (rows.reduce((sum, item) => sum + item.usage.requests, 0) / rows.length).toFixed(1),
              Math.round(rows.reduce((sum, item) => sum + item.usage.inputTokens + item.usage.outputTokens, 0) / rows.length)]) row.append(text('td', String(value)));
            table.append(row);
          }
          monitor.append(table, text('p', 'So sánh mang tính mô tả; các yêu cầu khác nhau không chứng minh mức tiết kiệm. Không có số đo trước nâng cấp nếu chưa chạy đối chứng.', 'ai-chat-note'));
          monitor.append(button('Tải usage JSON', () => {
            const url = URL.createObjectURL(new Blob([JSON.stringify({ workflows: state.workflows, usage: state.usage }, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a'); link.href = url; link.download = 'ai-usage.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }));
        }
      }
      async function mutate(action, body) {
        if (isBusy() || pending) return;
        pending = true; render(); error.textContent = '';
        try {
          const response = await fetch('/api/ai/agents/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Chưa lưu được kết nối AI.');
          state = result; reset(); await onChange();
        } catch (problem) { error.textContent = problem.message; }
        finally { pending = false; render(); }
      }
      function reset() { editing = null; form.reset(); fields.apiKey.value = ''; fields.provider.disabled = false; fields.apiKey.disabled = false; populateModels(); }
      function edit(agent) {
        editing = agent.id; form.reset(); fields.apiKey.value = '';
        for (const name of ['name', 'provider', 'role']) fields[name].value = agent[name];
        populateModels(agent.model);
        for (const name of ['tools', 'vision']) fields[name].checked = agent.capabilities[name];
        for (const name of ['requests', 'tokens', 'costUSD']) fields[name].value = agent.limits[name] ?? '';
        for (const name of ['input', 'cached', 'output']) fields[name + 'Price'].value = agent.pricing[name] ?? '';
        render(); fields.name.focus();
      }
      function body() { return { ...(editing ? { id: editing } : {}), name: fields.name.value.trim(), provider: fields.provider.value, model: modelValue(), role: fields.role.value,
        ...(fields.apiKey.value ? { apiKey: fields.apiKey.value.trim() } : {}), capabilities: { tools: fields.tools.checked, vision: fields.vision.checked },
        limits: { requests: numeric('requests'), tokens: numeric('tokens'), costUSD: numeric('costUSD') }, pricing: { input: numeric('inputPrice'), cached: numeric('cachedPrice'), output: numeric('outputPrice') } }; }
      form.addEventListener('submit', event => { event.preventDefault(); const data = body(); fields.apiKey.value = ''; mutate('save', data); });
      container.querySelector('[data-new]').addEventListener('click', () => { reset(); render(); });
      container.querySelector('[data-import]').addEventListener('click', () => {
        const data = body(); delete data.id; delete data.apiKey;
        // Server resolves and validates the selected OAuth account and its model.
        if (!data.name) data.name = 'ChatGPT'; if (!data.model) delete data.model;
        mutate('import-chatgpt', data);
      });
      container.querySelector('[data-import-api]').addEventListener('click', () => {
        const data = body(); delete data.id; delete data.apiKey;
        if (!data.name) data.name = 'OpenAI API'; if (!data.model) delete data.model;
        mutate('import-api', data);
      });
      async function refresh() {
        try { const response = await fetch('/api/ai/agents', { cache: 'no-store' }); if (response.ok) { state = await response.json(); render(); } }
        catch { /* Main connection status explains a missing localhost server. */ }
      }
      populateModels();
      return { refresh, render, policy() {
        const result = {};
        for (const field of container.querySelectorAll('[data-policy]')) result[field.dataset.policy] = field.type === 'checkbox' ? field.checked : field.tagName === 'SELECT' ? field.value : field.value === '' ? null : Number(field.value);
        return result;
      } };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
