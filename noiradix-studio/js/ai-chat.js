(function (root) {
  'use strict';
  root.AiChat = {
    mount({ captureTarget, beginTurn, describeTarget }) {
      const el = id => document.getElementById(id);
      const panel = el('ai-chat-panel'), toggle = el('btn-toggle-ai-chat');
      const input = el('ai-chat-input'), target = el('ai-chat-target'), send = el('btn-ai-chat-send');
      const stop = el('btn-ai-chat-stop'), messages = el('ai-chat-messages'), activity = el('ai-chat-activity');
      const setup = el('ai-chat-setup'), keyInput = el('ai-chat-api-key'), main = document.querySelector('.studio-main');
      const login = el('btn-ai-chat-login'), profiles = el('ai-chat-account-profile'), modelPicker = el('ai-chat-model'), planDialog = el('ai-chat-plan-dialog');
      const preferences = el('ai-chat-preferences'), settingsButton = el('btn-ai-chat-settings');
      const attachButton = el('btn-ai-chat-attach'), imageInput = el('input-ai-chat-images'), attachmentList = el('ai-chat-attachments');
      let attachments = [], loadingImages = false;
      const downloadUrls = new Set();
      let configured = false, controller = null, history = [], checking = false, wasInert = false, authBusy = false, loginPoll = null, provider = 'none';
      let account = { pending: false, connected: false, sharing: false, profiles: [], models: [] };
      const agents = root.AiAgentManager.mount({ container: el('ai-chat-agent-manager'), monitor: el('ai-agent-monitor'),
        isBusy: () => Boolean(controller) || authBusy, onChange: async () => { history = []; await checkConnection(); } });
      const googleSettings = root.AiGoogleSettings.mount({ isBusy: () => Boolean(controller) || authBusy, onChange: async () => { history = []; await checkConnection(); } });
      const accountTeam = root.AiAccountTeam.mount({ container: el('ai-account-team-settings'), monitor: el('ai-account-team-monitor'),
        isBusy: () => Boolean(controller) || authBusy, onChange: async () => { history = []; await checkConnection(); },
        onOpen: name => selectSettingsTab(el(name === 'google' ? 'ai-settings-tab-google' : 'ai-settings-tab-account')) });
      let workflowPoll = null;
      const toolNames = { pen: 'Bút', eraser: 'Tẩy', line: 'Đường thẳng', rectangle: 'Hình chữ nhật', fill: 'Tô màu', create_frame: 'Tạo frame', studio: 'Thao tác Studio' };
      function trimMessages() {
        while (messages.children.length > 60) {
          const item = messages.firstElementChild;
          for (const link of item.querySelectorAll('a[download]')) { URL.revokeObjectURL(link.href); downloadUrls.delete(link.href); }
          item.remove();
        }
        messages.scrollTop = messages.scrollHeight;
      }
      function noteFiles(files) {
        if (!files.length) return;
        const item = document.createElement('div'); item.className = 'ai-chat-message ai-chat-files'; item.dataset.role = 'files';
        const label = document.createElement('strong'); label.textContent = 'File kết quả'; item.appendChild(label);
        for (const file of files) {
          const url = URL.createObjectURL(file.blob); downloadUrls.add(url);
          const link = document.createElement('a'); link.href = url; link.download = file.name; link.textContent = '↓ ' + file.name; link.className = 'btn btn-secondary'; item.appendChild(link);
        }
        messages.appendChild(item); trimMessages();
      }
      window.addEventListener('unload', () => { for (const url of downloadUrls) URL.revokeObjectURL(url); });
      function setPreferences(open, focus = false) {
        if (open && !preferences.open) preferences.showModal();
        else if (!open && preferences.open) preferences.close();
        settingsButton.setAttribute('aria-expanded', String(open));
        if (focus) (open ? el('btn-close-ai-chat-settings') : settingsButton).focus();
      }
      settingsButton.addEventListener('click', () => setPreferences(!preferences.open, true));
      el('btn-close-ai-chat-settings').addEventListener('click', () => setPreferences(false, true));
      preferences.addEventListener('close', () => { if (preferences.open) return; settingsButton.setAttribute('aria-expanded', 'false'); if (!panel.classList.contains('hidden')) settingsButton.focus(); });
      preferences.addEventListener('cancel', event => { event.preventDefault(); setPreferences(false, true); });
      preferences.addEventListener('keydown', event => { event.stopPropagation(); });
      const settingsTabs = Array.from(preferences.querySelectorAll('[data-ai-settings-tab]'));
      function selectSettingsTab(selected) {
        for (const tab of settingsTabs) {
          const active = tab === selected;
          tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
          el(tab.getAttribute('aria-controls')).classList.toggle('hidden', !active);
        }
      }
      settingsTabs.forEach((tab, index) => {
        tab.addEventListener('click', () => selectSettingsTab(tab));
        tab.addEventListener('keydown', event => {
          let next;
          if (event.key === 'ArrowRight') next = (index + 1) % settingsTabs.length;
          else if (event.key === 'ArrowLeft') next = (index + settingsTabs.length - 1) % settingsTabs.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = settingsTabs.length - 1;
          else return;
          event.preventDefault(); selectSettingsTab(settingsTabs[next]); settingsTabs[next].focus();
        });
      });
      function friendlyError(text) {
        if (/locked|hidden|unlocked|visible layer/i.test(text)) return 'Lớp đang bị khóa hoặc ẩn. Hãy mở khóa và hiển thị lớp trước khi vẽ.';
        if (/select a frame|open a project/i.test(text)) return 'Hãy chọn hoặc mở một khung hình trước khi vẽ.';
        if (/Apply or discard/i.test(text)) return 'Hãy áp dụng hoặc bỏ các thay đổi trong tab mã trước khi vẽ.';
        if (/too large|smaller frame/i.test(text)) return 'Hình có quá nhiều dữ liệu để AI đọc. Hãy dùng khung nhỏ hơn hoặc chọn một lớp đơn giản hơn.';
        if (/Failed to fetch|NetworkError|JSON/i.test(text)) return 'Không kết nối được máy chủ AI. Kiểm tra máy chủ localhost rồi thử lại.';
        return /[À-ỹ]/.test(text) ? text : 'Chưa thực hiện được yêu cầu. Hãy thử lại.';
      }
      function note(role, text, photos = []) {
        if (!text && !photos.length) return;
        const item = document.createElement('div'); item.className = 'ai-chat-message'; item.dataset.role = role;
        const label = document.createElement('strong'); label.textContent = role === 'user' ? 'Bạn' : role === 'assistant' ? 'AI' : 'Thông báo';
        const content = document.createElement('span'); content.textContent = text;
        item.append(label, content); messages.appendChild(item);
        if (photos.length) {
          const gallery = document.createElement('div'); gallery.className = 'ai-chat-message-images';
          for (const photo of photos) { const img = document.createElement('img'); img.src = photo.dataUrl; img.alt = photo.name; gallery.appendChild(img); }
          item.appendChild(gallery);
        }
        trimMessages();
      }
      function refreshContext() { el('ai-chat-context').textContent = describeTarget(target.value); }
      function renderAttachments() {
        attachmentList.replaceChildren(); attachmentList.classList.toggle('hidden', !attachments.length);
        attachments.forEach((photo, index) => {
          const card = document.createElement('div'); card.className = 'ai-chat-attachment';
          const img = document.createElement('img'); img.src = photo.dataUrl; img.alt = photo.name;
          const name = document.createElement('span'); name.textContent = photo.name; name.title = photo.name;
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-round-btn btn-xs'; remove.textContent = '×'; remove.setAttribute('aria-label', 'Bỏ ảnh ' + photo.name); remove.disabled = Boolean(controller) || loadingImages;
          remove.addEventListener('click', () => { if (!controller && !loadingImages) { attachments.splice(index, 1); renderAttachments(); } });
          card.append(img, name, remove); attachmentList.appendChild(card);
        });
      }
      async function addImages(files) {
        if (controller || loadingImages) return;
        const photos = Array.from(files);
        if (!photos.length) return;
        if (photos.length + attachments.length > AiImages.maxImages) { note('error', `Mỗi tin nhắn nhận tối đa ${AiImages.maxImages} ảnh.`); return; }
        loadingImages = true; connectionControls();
        try { for (const file of photos) attachments.push(await AiImages.fromFile(file)); }
        catch (error) { note('error', error.message); }
        finally { loadingImages = false; renderAttachments(); connectionControls(); input.focus(); }
      }
      attachButton.addEventListener('click', () => imageInput.click());
      imageInput.addEventListener('change', () => { const files = Array.from(imageInput.files || []); imageInput.value = ''; addImages(files); });
      panel.addEventListener('paste', event => {
        event.stopPropagation();
        const photos = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
        if (photos.length) { event.preventDefault(); addImages(photos); }
      });
      panel.addEventListener('dragover', event => { event.preventDefault(); event.stopPropagation(); panel.classList.add('is-dragging-image'); });
      panel.addEventListener('dragleave', event => { if (!panel.contains(event.relatedTarget)) panel.classList.remove('is-dragging-image'); });
      panel.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); panel.classList.remove('is-dragging-image'); addImages(event.dataTransfer?.files || []); });
      function connectionLabel() {
        el('ai-chat-connection').textContent = account.pending ? 'Đang chờ bạn đăng nhập và cấp quyền trên trang OpenAI…' : configured ?
          (provider === 'accounts' ? 'Nhóm tài khoản · ChatGPT + Gemini' : provider === 'google' ? 'Google · Đã kết nối' : provider === 'chatgpt' ? 'ChatGPT · Đã kết nối' : provider === 'agents' ? 'Nhóm AI · Đã cấu hình' : 'AI · Đã kết nối') :
          provider === 'accounts' ? 'Mở Cài đặt ⚙ → Nhóm tài khoản để hoàn tất kết nối.' :
          provider === 'google' ? 'Mở Cài đặt ⚙ → Google để hoàn tất kết nối.' :
          account.connected ? 'Mở Cài đặt để kiểm tra quyền dùng AI.' : 'Mở Cài đặt ⚙ để đăng nhập ChatGPT.';
      }
      function connectionControls() {
        const blocked = Boolean(controller) || authBusy;
        send.disabled = blocked || checking || (!configured && !(root.AiLocalTasks.route(input.value) && !attachments.length)) || account.pending || loadingImages;
        attachButton.disabled = blocked || loadingImages;
        settingsButton.disabled = Boolean(controller);
        el('ai-agent-mode').disabled = Boolean(controller) || ['google', 'chatgpt', 'accounts'].includes(provider);
        googleSettings.render(); accountTeam.render();
        attachmentList.querySelectorAll('button').forEach(button => { button.disabled = blocked || loadingImages; });
        login.disabled = blocked || account.pending;
        login.classList.toggle('hidden', account.connected && !account.error && profiles.value !== '');
        el('btn-ai-chat-use-account').disabled = blocked || account.pending;
        el('btn-ai-chat-use-agents').disabled = blocked || account.pending;
        el('btn-ai-chat-reauth').classList.toggle('hidden', !login.classList.contains('hidden'));
        el('btn-ai-chat-reauth').disabled = blocked || account.pending;
        profiles.disabled = blocked || account.pending; modelPicker.disabled = blocked || account.pending;
        el('btn-ai-chat-logout').disabled = blocked || account.pending;
        el('btn-ai-chat-login-cancel').disabled = blocked;
        el('btn-ai-chat-connect').disabled = blocked || account.pending;
        el('btn-ai-chat-reconnect').disabled = blocked;
      }
      function applyConnection(status) {
        configured = status.configured === true; provider = status.provider || (configured ? 'api' : 'none');
        googleSettings.apply(status.google);
        accountTeam.apply(status);
        el('ai-agent-monitor').classList.toggle('hidden', ['google', 'accounts'].includes(provider));
        account = status.login || { pending: false, connected: false, sharing: false, profiles: [], models: [] };
        el('ai-chat-login-intro').textContent = 'Dùng tài khoản ChatGPT của bạn trong Studio. Không cần API key hoặc cài CLI riêng.';
        el('ai-chat-source-status').textContent = provider === 'chatgpt' && configured ? 'Đang dùng ChatGPT cho chat và vẽ trong Studio.' :
          account.connected && account.sharing ? 'ChatGPT đã kết nối. Bấm Dùng ChatGPT để chuyển chat sang tài khoản này.' :
          account.connected ? 'Đã đăng nhập nhưng chưa có quyền dùng gói. Bấm Đăng nhập lại và cấp quyền cho Studio.' : 'Bấm Continue with ChatGPT để đăng nhập trên trang OpenAI.';
        el('btn-ai-chat-use-account').classList.toggle('hidden', provider === 'chatgpt' || !account.connected || !account.sharing);
        el('btn-ai-chat-use-agents').classList.toggle('hidden', provider !== 'chatgpt' || !(status.agentsAvailable || status.apiKeyAvailable));
        const previous = profiles.value;
        profiles.replaceChildren(new Option('Thêm tài khoản ChatGPT…', ''));
        for (const item of account.profiles) profiles.add(new Option(item.label, item.clientId));
        if (account.activeClientId && !account.pending) profiles.value = account.activeClientId;
        else if (account.profiles.some(item => item.clientId === previous)) profiles.value = previous;
        profiles.classList.toggle('hidden', !account.profiles.length);
        const activeLabel = account.profiles.find(item => item.clientId === account.activeClientId)?.label;
        el('ai-chat-account-active').textContent = activeLabel ? 'Tài khoản đang chọn: ' + activeLabel : '';
        el('ai-chat-account-active').classList.toggle('hidden', !activeLabel);
        modelPicker.replaceChildren();
        for (const model of account.models) modelPicker.add(new Option(model.name, model.id));
        modelPicker.value = account.model || '';
        el('ai-chat-model-controls').classList.toggle('hidden', !account.models.length);
        el('btn-ai-chat-logout').classList.toggle('hidden', !account.connected);
        el('btn-ai-chat-login-cancel').classList.toggle('hidden', !account.pending);
        el('ai-chat-plan-usage').classList.toggle('hidden', provider !== 'chatgpt' || !account.connected || !account.sharing);
        el('ai-chat-login-status').textContent = account.error || (account.pending ? 'Hoàn tất đăng nhập trong cửa sổ vừa mở, rồi quay lại Studio.' : account.connected ? 'Đã lưu phiên đăng nhập trên máy này. Bạn có thể đăng xuất hoặc thêm tài khoản khác.' : 'Đăng nhập trên trang OpenAI; Studio không yêu cầu mật khẩu của bạn. Tính năng dùng gói tùy thuộc tài khoản và quyền được cấp.');
        if (provider === 'chatgpt' && account.welcomeNeeded && !account.pending && !planDialog.open) planDialog.showModal();
        if ((!account.welcomeNeeded || provider !== 'chatgpt') && planDialog.open) planDialog.close();
        if (!account.pending) {
          if (loginPoll) { clearInterval(loginPoll); loginPoll = null; }
          el('ai-chat-login-link').classList.add('hidden');
        }
        connectionLabel(); connectionControls();
      }
      function busy(active) {
        target.disabled = active; el('ai-agent-mode').disabled = active; connectionControls(); agents.render();
        stop.classList.toggle('hidden', !active); activity.classList.toggle('hidden', !active);
        document.body.classList.toggle('ai-drawing-busy', active);
        if (active) { wasInert = main.inert; main.inert = true; }
        else main.inert = wasInert;
        panel.setAttribute('aria-busy', String(active));
      }
      async function checkConnection() {
        if (controller || checking) return;
        checking = true;
        try {
          const response = await fetch('/api/ai/status', { cache: 'no-store' });
          if (!response.ok) throw new Error('unavailable');
          applyConnection(await response.json());
          await agents.refresh();
          el('ai-chat-setup-status').textContent = '';
        } catch {
          configured = false;
          el('ai-chat-connection').textContent = 'Chưa kết nối được máy chủ AI. Mở Cài đặt ⚙ để kiểm tra.';
        } finally {
          checking = false; connectionControls();
        }
      }
      function show(open) {
        if (!open) setPreferences(false);
        panel.classList.toggle('hidden', !open); toggle.setAttribute('aria-expanded', String(open));
        if (open) { refreshContext(); input.focus(); checkConnection(); if (!workflowPoll) workflowPoll = setInterval(() => agents.refresh(), 2000); }
        else if (workflowPoll) { clearInterval(workflowPoll); workflowPoll = null; }
        window.dispatchEvent(new Event('resize'));
      }
      toggle.addEventListener('click', () => show(panel.classList.contains('hidden')));
      el('btn-close-ai-chat').addEventListener('click', () => { if (!controller) show(false); });
      async function authRequest(action, body = {}) {
        const response = await fetch('/api/ai/auth/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Chưa thực hiện được thao tác đăng nhập.');
        if (result.login) applyConnection(result);
        return result;
      }
      async function changeAccount(action, body = {}) {
        if (controller || authBusy) return;
        authBusy = true; connectionControls();
        try {
          const result = await authRequest(action, body);
          history = [];
          if (result.message) note('status', result.message);
        } catch (error) { el('ai-chat-login-status').textContent = friendlyError(error.message); }
        finally { authBusy = false; connectionControls(); }
      }
      login.addEventListener('click', async () => {
        if (controller || authBusy || account.pending) return;
        const popup = window.open('about:blank', 'noiradix-chatgpt-signin', 'width=560,height=780');
        if (popup) popup.opener = null;
        authBusy = true; connectionControls();
        try {
          const result = await authRequest('start', { clientId: profiles.value || null });
          const link = el('ai-chat-login-link'); link.href = result.openUrl;
          link.classList.remove('hidden');
          if (popup) popup.location.replace(result.openUrl);
          await checkConnection();
          if (!loginPoll) loginPoll = setInterval(checkConnection, 2000);
        } catch (error) { if (popup) popup.close(); el('ai-chat-login-status').textContent = friendlyError(error.message); }
        finally { authBusy = false; connectionControls(); }
      });
      el('btn-ai-chat-login-cancel').addEventListener('click', () => changeAccount('cancel'));
      async function changeSource(next) {
        if (controller || authBusy || account.pending) return;
        authBusy = true; connectionControls();
        try {
          const response = await fetch('/api/ai/source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: next }) });
          const result = await response.json();
          if (!response.ok) throw new Error(response.status === 404 ? 'Mở lại Studio bằng file khởi động để nạp bản cập nhật đăng nhập ChatGPT.' : result.error || 'Chưa đổi được kết nối AI.');
          history = []; applyConnection(result);
        } catch (error) { el('ai-chat-source-status').textContent = friendlyError(error.message); }
        finally { authBusy = false; connectionControls(); }
      }
      el('btn-ai-chat-use-account').addEventListener('click', () => changeSource('chatgpt'));
      el('btn-ai-chat-use-agents').addEventListener('click', () => changeSource('agents'));
      el('btn-ai-chat-reauth').addEventListener('click', () => login.click());
      el('btn-ai-chat-logout').addEventListener('click', () => changeAccount('logout'));
      profiles.addEventListener('change', () => {
        if (profiles.value) changeAccount('select', { clientId: profiles.value });
        else connectionControls();
      });
      modelPicker.addEventListener('change', () => changeAccount('model', { model: modelPicker.value }));
      el('btn-ai-chat-reconnect').addEventListener('click', async () => {
        if (provider === 'chatgpt' && account.connected && account.sharing) await changeAccount('models');
        else await checkConnection();
      });
      planDialog.addEventListener('keydown', event => event.stopPropagation());
      planDialog.addEventListener('cancel', event => { event.preventDefault(); el('btn-ai-chat-plan-ack').click(); });
      el('btn-ai-chat-plan-ack').addEventListener('click', async () => {
        const button = el('btn-ai-chat-plan-ack'); button.disabled = true;
        try { await authRequest('ack'); el('ai-chat-plan-error').textContent = ''; }
        catch (error) { el('ai-chat-plan-error').textContent = friendlyError(error.message); }
        finally { button.disabled = false; }
      });
      target.addEventListener('change', () => { history = []; refreshContext(); });
      // Keep editor shortcuts and pointer edits out of an in-progress transaction.
      panel.addEventListener('keydown', event => event.stopPropagation());
      for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'keydown', 'drop', 'paste', 'contextmenu']) {
        window.addEventListener(type, event => {
          if (controller && !panel.contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
        }, true);
      }
      el('ai-chat-connect-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (controller) return;
        const apiKey = keyInput.value.trim();
        if (!apiKey) { keyInput.focus(); return; }
        const button = el('btn-ai-chat-connect'); button.disabled = true;
        try {
          const response = await fetch('/api/ai/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Không lưu được kết nối.');
          keyInput.value = ''; applyConnection(result); setup.open = false;
          el('ai-chat-setup-status').textContent = 'Đã lưu kết nối trên máy này.';
          if (!preferences.open) input.focus();
        } catch (error) { el('ai-chat-setup-status').textContent = friendlyError(error.message); }
        finally { button.disabled = false; }
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault(); if (!send.disabled) el('ai-chat-form').requestSubmit();
        }
      });
      input.addEventListener('input', connectionControls);
      function googlePermission(permission, signal) {
        return new Promise((resolve, reject) => {
          const card = document.createElement('div'); card.className = 'ai-chat-message ai-google-permission';
          const title = document.createElement('strong'); title.textContent = 'Google yêu cầu quyền thao tác';
          const description = document.createElement('p'); description.textContent = permission.title;
          const details = document.createElement('pre'); details.textContent = permission.details;
          const actions = document.createElement('div'); actions.className = 'ai-chat-actions';
          const finish = optionId => { signal.removeEventListener('abort', aborted); actions.querySelectorAll('button').forEach(item => { item.disabled = true; }); resolve({ id: permission.id, optionId }); };
          const aborted = () => { actions.querySelectorAll('button').forEach(item => { item.disabled = true; }); reject(new DOMException('Stopped', 'AbortError')); };
          for (const option of permission.options) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-secondary';
            button.textContent = option.kind === 'allow_once' ? 'Cho phép lần này' : 'Từ chối'; button.addEventListener('click', () => finish(option.id), { once: true }); actions.append(button);
          }
          card.append(title, description, details, actions); messages.append(card); trimMessages();
          signal.addEventListener('abort', aborted, { once: true });
          if (signal.aborted) aborted();
        });
      }
      async function request(body, signal, endpoint = '/api/ai/agent') {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
        const answer = await response.json();
        if (!response.ok) throw new Error(answer.error || 'Máy chủ AI chưa trả lời được.');
        return answer;
      }
      el('ai-chat-form').addEventListener('submit', async event => {
        event.preventDefault();
        const message = input.value.trim() || (attachments.length ? 'Dựa vào ảnh đính kèm, hãy vẽ lại thành pixel art trong frame.' : '');
        if (!message || (!configured && !(root.AiLocalTasks.route(message) && !attachments.length)) || controller || checking || authBusy || account.pending || loadingImages) return;
        const sentImages = attachments.slice();
        const availableImages = sentImages.length ? sentImages : history.findLast(item => item.role === 'user' && item.images?.length)?.images || [];
        let snapshot, turn;
        try {
          snapshot = captureTarget(target.value);
          snapshot.context.attachments = availableImages.map((photo, index) => ({ index, name: photo.name }));
          turn = beginTurn(snapshot, availableImages);
        }
        catch (error) { note('error', friendlyError(error.message)); return; }
        controller = new AbortController();
        const signal = controller.signal;
        setPreferences(false);
        const timeout = setTimeout(() => controller?.abort('timeout'), 600000);
        let runId = null, completed = false, count = 0, reply = '';
        const local = root.AiLocalTasks.route(message) && !sentImages.length;
        const endpoint = !local && provider === 'accounts' ? '/api/ai/team/turn' : !local && provider === 'google' ? '/api/ai/google/turn' : '/api/ai/agent';
        busy(true); el('btn-close-ai-chat').disabled = true;
        note('user', message, sentImages); input.value = ''; activity.textContent = 'AI đang xem dự án và chuẩn bị thực hiện yêu cầu…';
        try {
          const priorHistory = sentImages.length ? history.map(({ images, ...item }) => item) : history;
          let body = { message, context: snapshot.context, history: priorHistory, images: sentImages, mode: el('ai-agent-mode').value, policy: provider === 'agents' ? agents.policy() : {} };
          for (let round = 0; round < 32;) {
            const answer = await request(body, signal, endpoint);
            if (answer.team) accountTeam.workflow(answer.team);
            agents.refresh();
            if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
            runId = answer.runId;
            if (answer.reply) { reply += (reply ? '\n' : '') + answer.reply; note('assistant', answer.reply); }
            if (answer.done === true) { completed = true; break; }
            if (answer.permission) { body = { runId, permission: await googlePermission(answer.permission, signal) }; continue; }
            if (answer.waiting === true) { body = { runId, poll: true }; continue; }
            if (!Array.isArray(answer.calls) || !answer.calls.length || answer.calls.length > 4) throw new Error('AI gửi thao tác chưa hợp lệ.');
            round++;
            const results = [];
            for (const call of answer.calls) {
              if (call.name === 'inspect_canvas') activity.textContent = 'AI đang xem lại hình vừa vẽ…';
              if (call.name === 'create_frame') activity.textContent = 'AI đang tạo thêm frame từ ảnh mẫu…';
              if (call.name === 'inspect_studio') activity.textContent = 'AI đang kiểm tra frame, animation và layer…';
              if (call.name === 'studio_actions') activity.textContent = 'AI đang thao tác trong Studio…';
              const output = await turn.execute(call, signal, action => {
                count++;
                activity.textContent = `${action.label || toolNames[action.tool]} · ${count} thao tác đã thực hiện…`;
              });
              results.push({ callId: call.callId, output });
            }
            body = { runId, results };
          }
          if (!completed) throw new Error('Đã đạt giới hạn lượt vẽ. Hãy thử yêu cầu nhỏ hơn.');
          const changed = turn.finish();
          const files = turn.takeFiles?.() || [];
          noteFiles(files);
          if (sentImages.length) history = history.map(({ images, ...item }) => item);
          history.push({ role: 'user', content: message, images: sentImages }, { role: 'assistant', content: reply || 'Đã xử lý yêu cầu.' }); history = history.slice(-12);
          attachments = []; renderAttachments();
          if (changed) {
            target.value = turn.targetMode?.() || 'edit'; refreshContext();
            note('status', `Đã thực hiện ${count} thao tác. Nhấn ⌘Z / Ctrl+Z để hoàn tác cả lượt.`);
          } else note('status', files.length ? 'File đã sẵn sàng. Bấm tên file để tải xuống.' : 'Không có thay đổi trên dự án trong lượt này.');
        } catch (error) {
          if (signal.aborted) {
            turn.cancel();
            note('error', signal.reason === 'timeout' ? 'AI mất quá lâu để trả lời. Hình trước lượt vẽ đã được khôi phục.' : 'Đã dừng và khôi phục hình trước lượt vẽ này.');
          } else {
            const changed = turn.finish(); noteFiles(turn.takeFiles?.() || []);
            if (changed) { target.value = turn.targetMode?.() || 'edit'; refreshContext(); }
            note('error', friendlyError(error.message) + (changed ? ' Lượt chưa hoàn tất; các thay đổi đã thực hiện được giữ lại. Nhấn ⌘Z / Ctrl+Z để hoàn tác.' : ' Hình trước lượt vẽ được giữ nguyên.'));
          }
          if (!input.value) input.value = message;
        } finally {
          clearTimeout(timeout);
          if (runId && !completed) fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId, cancel: true }) }).catch(() => {});
          controller = null; busy(false); el('btn-close-ai-chat').disabled = false; checkConnection();
        }
      });
      stop.addEventListener('click', () => controller?.abort());
      refreshContext();
      const settingsPage = new URL(location.href).searchParams.get('ai-settings');
      if (['google', 'chatgpt', 'accounts'].includes(settingsPage)) {
        show(true); selectSettingsTab(el(settingsPage === 'google' ? 'ai-settings-tab-google' : settingsPage === 'accounts' ? 'ai-settings-tab-agents' : 'ai-settings-tab-account')); setPreferences(true, true);
      }
      return { refreshContext, show };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
