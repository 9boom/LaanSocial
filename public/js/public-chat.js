/* Public chat: MongoDB history, WebSocket realtime, presence, typing, reply, and attachments. */
(function(){
  const STORAGE = window.IDBStorage;
  const ACCESS_KEY_PREFIX = 'access_hkey_';
  const PAGE_SIZE = 10;
  const JOINED_PING_MS = 60 * 1000;
  const TYPING_IDLE_MS = 1400;
  const FALLBACK_AVATAR = 'assets/sim_db/users_profile_image/annonymous.png';

  const messagesEl = document.getElementById('publicMessages');
  const composerForm = document.getElementById('composerForm');
  const composerInput = document.getElementById('publicComposerInput');
  const attachBtn = document.getElementById('publicAttachBtn');
  const attachmentInput = document.getElementById('publicAttachmentInput');
  const typingBar = document.getElementById('publicTypingBar');
  const titleEl = document.getElementById('publicChatTitle');
  const countEl = document.getElementById('publicChatCount');
  const descEl = document.getElementById('publicChatDesc');
  const onlineListEl = document.getElementById('onlineList');
  const onlineHeaderCountEl = document.querySelector('.online-panel-header h3 b');
  const uniOnlineEl = document.querySelector('.uni-card .online');

  const state = {
    activeSubroom: null,
    activeUniversity: null,
    activeUniversityName: '',
    messages: [],
    messageIds: new Set(),
    loadingHistory: false,
    hasMore: true,
    ws: null,
    pingTimer: null,
    typingTimer: null,
    isTyping: false,
    typingUsers: new Map(),
    selectedAttachment: null,
    currentUserId: '',
    currentUser: null,
    allOnlineUsers: [],
    onlineSearchQuery: ''
  };

  function canUseStorage(){
    return STORAGE && typeof STORAGE.getItem === 'function';
  }

  async function getCurrentUserId(){
    if(!canUseStorage()) return '';
    return (await STORAGE.getItem('current_loggedin')) || '';
  }

  async function getAccessHKey(){
    const userId = await getCurrentUserId();
    if(!userId || !canUseStorage()) return '';
    return (await STORAGE.getItem(`${ACCESS_KEY_PREFIX}${userId}`)) || '';
  }

  async function authHeaders(){
    const accessKey = await getAccessHKey();
    if(!accessKey) throw new Error('กรุณาเข้าสู่ระบบใหม่');
    return { 'X-Access-HKey': accessKey };
  }

  function escapeHtml(value){
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    }[char]));
  }

  function socialMediaAttrs(socialMedia){
    const facebook = socialMedia && typeof socialMedia.facebook === 'string' ? socialMedia.facebook : '';
    const instagram = socialMedia && typeof socialMedia.instagram === 'string' ? socialMedia.instagram : '';
    return `data-profile-facebook="${escapeHtml(facebook)}" data-profile-instagram="${escapeHtml(instagram)}"`;
  }

  function cssEscape(value){
    if(window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value || '').replace(/["\\]/g, '\\$&');
  }

  function formatSubroomName(name){
    const value = typeof name === 'string' ? name.trim() : '';
    if(!value) return '#ไม่ระบุชื่อห้อง';
    return value.startsWith('#') ? value : `#${value}`;
  }

  function formatTime(value){
    const date = new Date(value);
    if(Number.isNaN(date.getTime())) return '';
    return date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
  }

  function userTag(user){
    const source = user?.user_uniname || '';
    const match = source.match(/\[([^\]]+)\]/);
    return match ? `[${match[1]}]` : '';
  }

  function getPlainComposerText(trim = false){
    const text = (composerInput?.innerText || composerInput?.textContent || '').replace(/\u00a0/g, ' ').replace(/\r?\n/g, '');
    return trim ? text.trim() : text;
  }

  function setComposerPlainText(text){
    if(!composerInput) return;
    if(!text){
      composerInput.innerHTML = '';
      return;
    }
    composerInput.textContent = text;
    highlightComposerPrefix(true);
  }

  function getCaretOffset(element){
    const selection = window.getSelection();
    if(!selection || selection.rangeCount === 0) return 0;
    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    return preCaretRange.toString().length;
  }

  function setCaretOffset(element, offset){
    const range = document.createRange();
    const selection = window.getSelection();
    let remaining = offset;
    let found = false;

    function walk(node){
      if(found) return;
      if(node.nodeType === Node.TEXT_NODE){
        const length = node.nodeValue.length;
        if(remaining <= length){
          range.setStart(node, remaining);
          found = true;
          return;
        }
        remaining -= length;
        return;
      }
      Array.from(node.childNodes).forEach(walk);
    }

    walk(element);
    if(!found) range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function highlightedMessageHtml(text){
    const value = String(text || '');
    const match = value.match(/^([^:\n]{1,60})\s:\s(.*)$/s);
    if(!match) return escapeHtml(value);
    return `<span class="reply-prefix">${escapeHtml(match[1])}</span> : ${escapeHtml(match[2])}`;
  }

  function highlightComposerPrefix(forceEnd){
    if(!composerInput) return;
    const text = getPlainComposerText(false);
    const hasPrefix = /^([^:\n]{1,60})\s:\s/.test(text);
    if(!hasPrefix && !forceEnd) return;

    composerInput.innerHTML = highlightedMessageHtml(text);
    if(document.activeElement !== composerInput){
      composerInput.focus();
    }
    setCaretOffset(composerInput, text.length);
  }

  function setTypingBar(){
    if(!typingBar) return;
    const users = Array.from(state.typingUsers.values());
    if(!users.length){
      typingBar.hidden = true;
      typingBar.textContent = '';
      return;
    }
    typingBar.hidden = false;
    typingBar.textContent = `${users.map(user => user.user_nick).join(', ')} กำลังพิม...`;
  }

  function setMessageState(message, className){
    if(!messagesEl) return;
    messagesEl.innerHTML = `<p class="${className}">${escapeHtml(message)}</p>`;
  }

  function attachmentPreviewHtml(url){
    if(!url) return '';
    const safeUrl = escapeHtml(url);
    const lower = url.toLowerCase();
    const fileName = safeUrl.split('/').pop() || 'file';
    if(/\.(png|jpe?g|webp|gif)$/.test(lower)){
      return `<div class="msg-attachment image-attachment">
        <img src="${safeUrl}" alt="ไฟล์แนบ" loading="lazy">
        <div class="attachment-actions">
          <a href="${safeUrl}" download="${fileName}" target="_blank" rel="noopener" class="attachment-download-btn">
            <img src="assets/symbols/download.svg" alt=""> ดาวน์โหลด
          </a>
        </div>
      </div>`;
    }
    return `<div class="msg-attachment file-attachment">
      <a href="${safeUrl}" target="_blank" rel="noopener" class="file-link">เปิดไฟล์แนบ</a>
      <a href="${safeUrl}" download="${fileName}" target="_blank" rel="noopener" class="attachment-download-btn file-dl-btn">
        <img src="assets/symbols/download.svg" alt=""> ดาวน์โหลด
      </a>
    </div>`;
  }

  function renderMessage(message){
    const mine = message.user_owner_id && message.user_owner_id === state.currentUserId;
    const nick = message.user_nick || 'ไม่ระบุชื่อ';
    const tag = userTag(message);
    const avatar = message.user_profile_url || FALLBACK_AVATAR;
    const actions = mine ? '' : `<div class="msg-actions">
      <button class="msg-action report-trigger" data-report-tag="${escapeHtml(tag)}" data-report-name="${escapeHtml(nick)}"><img src="assets/symbols/report.svg" alt="">รายงาน</button>
      <button class="msg-action public-reply-btn" data-reply-user="${escapeHtml(nick)}"><img src="assets/symbols/reply.svg" alt="">ตอบกลับ</button>
    </div>`;

    const profileAttrs = `data-profile-nick="${escapeHtml(nick)}" data-profile-tag="${escapeHtml(tag)}" data-profile-avatar="${escapeHtml(avatar)}" data-profile-id="${escapeHtml(message.user_owner_id || 'USR-00000')}" data-profile-date="${escapeHtml(message.user_created_at || '')}" ${socialMediaAttrs(message.social_media)}`;

    const meta = mine
      ? `<span class="time">${formatTime(message.created_at)}</span><span class="tag user-profile-trigger" ${profileAttrs}>${escapeHtml(tag)}</span><span class="user-profile-trigger" ${profileAttrs}>${escapeHtml(nick)}</span>`
      : `<span class="tag user-profile-trigger" ${profileAttrs}>${escapeHtml(tag)}</span><span class="user-profile-trigger" ${profileAttrs}>${escapeHtml(nick)}</span><span class="time">${formatTime(message.created_at)}</span>${actions}`;

    return `<div class="msg${mine ? ' own' : ''}" data-chat-id="${escapeHtml(message.chat_id)}">
      <img class="avatar user-profile-trigger" ${profileAttrs} src="${escapeHtml(avatar)}" alt="${escapeHtml(nick)}">
      <div class="msg-body">
        <div class="msg-meta">${meta}</div>
        <p class="msg-text">${highlightedMessageHtml(message.message)}</p>
        ${attachmentPreviewHtml(message.attachment_url)}
      </div>
    </div>`;
  }

  function renderMessages(){
    if(!messagesEl) return;
    if(!state.activeSubroom){
      setMessageState('เลือก subroom เพื่อเริ่มคุย', 'chat-state empty');
      return;
    }
    if(!state.messages.length){
      setMessageState('ยังไม่มีข้อความในห้องนี้', 'chat-state empty');
      return;
    }
    messagesEl.innerHTML = state.messages.map(renderMessage).join('');
  }

  function appendMessage(message){
    if(!message || state.messageIds.has(message.chat_id)) return;
    if(state.activeSubroom && message.subroom_id !== state.activeSubroom.subroom_id) return;
    state.messageIds.add(message.chat_id);
    state.messages.push(message);
    renderMessages();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function prependMessages(messages){
    const previousHeight = messagesEl.scrollHeight;
    const freshMessages = messages.filter(message => !state.messageIds.has(message.chat_id));
    freshMessages.forEach(message => state.messageIds.add(message.chat_id));
    state.messages = freshMessages.concat(state.messages);
    renderMessages();
    messagesEl.scrollTop = messagesEl.scrollHeight - previousHeight;
  }

  function updateHeader(subroom){
    if(titleEl) titleEl.innerHTML = `${escapeHtml(formatSubroomName(subroom?.subroom_name || 'เลือกห้อง'))} <span class="dot">•</span> <span class="count" id="publicChatCount">${Number(subroom?.channel_count || 0)} คน</span>`;
    if(descEl) descEl.textContent = subroom?.subroom_desc || '';
  }

  function updateChannelCount(subroomId, count){
    document.querySelectorAll(`.channel[data-subroom-id="${cssEscape(subroomId)}"] .channel-count`).forEach(el => {
      el.textContent = `• ${Number(count || 0)} คน`;
      el.classList.toggle('zero', !Number(count || 0));
    });
    if(state.activeSubroom?.subroom_id === subroomId){
      const headerCount = document.getElementById('publicChatCount') || countEl;
      if(headerCount) headerCount.textContent = `${Number(count || 0)} คน`;
    }
  }

  function updateUniversityOnline(count){
    if(uniOnlineEl) uniOnlineEl.textContent = `กำลังอยู่ ${Number(count || 0)} คน`;
  }

  function renderOnlineList(users){
    if(Array.isArray(users)) state.allOnlineUsers = users;
    const allUsers = state.allOnlineUsers || [];
    if(onlineHeaderCountEl) onlineHeaderCountEl.textContent = String(allUsers.length);
    if(!onlineListEl) return;

    if(!allUsers.length){
      onlineListEl.innerHTML = '<p class="chat-state empty">ยังไม่มีใครออนไลน์ในห้องนี้</p>';
      return;
    }

    const onlineSearchInput = document.querySelector('.online-panel-search input');
    state.onlineSearchQuery = (onlineSearchInput?.value || '').trim().toLowerCase();
    const query = state.onlineSearchQuery;

    const filteredUsers = allUsers.filter(user => {
      if(!query) return true;
      const nick = (user.user_nick || '').toLowerCase();
      const tag = (userTag(user) || '').toLowerCase();
      const uni = (user.user_uniname || '').toLowerCase();
      return nick.includes(query) || tag.includes(query) || uni.includes(query);
    });

    if(!filteredUsers.length){
      onlineListEl.innerHTML = `<p class="chat-state empty">ไม่พบสมาชิกที่ตรงกับการค้นหา "${escapeHtml(query)}"</p>`;
      return;
    }

    onlineListEl.innerHTML = filteredUsers.map(user => {
      const mine = user.user_id === state.currentUserId;
      const nick = user.user_nick || '';
      const tag = userTag(user);
      const avatar = user.user_profile_url || FALLBACK_AVATAR;
      const profileAttrs = `data-profile-nick="${escapeHtml(nick)}" data-profile-tag="${escapeHtml(tag)}" data-profile-avatar="${escapeHtml(avatar)}" data-profile-id="${escapeHtml(user.user_id || 'USR-00000')}" data-profile-date="${escapeHtml(user.created_at || '')}" ${socialMediaAttrs(user.social_media)}`;

      return `<div class="online-member${mine ? ' self' : ''} user-profile-trigger" ${profileAttrs}>
        <img src="${escapeHtml(avatar)}" alt="">
        <span class="name"><span class="tag">${escapeHtml(tag)}</span> ${escapeHtml(nick)}${mine ? ' (คุณ)' : ''}</span>
      </div>`;
    }).join('');
  }

  function applyPresence(payload){
    if(!payload || !payload.subroom_id) return;
    updateChannelCount(payload.subroom_id, payload.channel_count);
    if(typeof payload.university_online_count !== 'undefined') updateUniversityOnline(payload.university_online_count);
    if(state.activeSubroom?.subroom_id === payload.subroom_id){
      renderOnlineList(payload.online_users || []);
    }
  }

  function sendWs(event, contentObj){
    if(!state.ws || state.ws.readyState !== WebSocket.OPEN) return false;
    state.ws.send(JSON.stringify({ event, content_obj: contentObj }));
    return true;
  }

  async function sendProtectedWs(event, contentObj){
    const accessKey = await getAccessHKey();
    if(!accessKey) throw new Error('กรุณาเข้าสู่ระบบใหม่');
    return sendWs(event, {
      ...contentObj,
      access_hkey: accessKey
    });
  }

  function connectWebSocket(){
    if(state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.ws = new WebSocket(`${protocol}//${window.location.host}/ws/public-chat`);

    state.ws.addEventListener('open', () => {
      pingPresence();
    });

    state.ws.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      const content = payload.content_obj || {};
      if(payload.event === 'message') appendMessage(content);
      if(payload.event === 'presence') applyPresence(content);
      if(payload.event === 'start_typing' && content.user_id !== state.currentUserId){
        state.typingUsers.set(content.user_id, content);
        setTypingBar();
      }
      if(payload.event === 'stop_typing'){
        state.typingUsers.delete(content.user_id);
        setTypingBar();
      }
      if(payload.event === 'error'){
        console.warn(content.message || 'WebSocket error');
      }
    });

    state.ws.addEventListener('close', () => {
      window.setTimeout(connectWebSocket, 1800);
    });
  }

  async function pingPresence(){
    if(!state.activeSubroom) return;
    try {
      await sendProtectedWs('joined_ping', { subroom_id: state.activeSubroom.subroom_id });
    } catch (error) {
      console.warn(error.message);
    }
  }

  function startPresenceTimer(){
    window.clearInterval(state.pingTimer);
    state.pingTimer = window.setInterval(pingPresence, JOINED_PING_MS);
  }

  async function loadHistory(before){
    if(!state.activeSubroom || state.loadingHistory) return;
    state.loadingHistory = true;
    try {
      const headers = await authHeaders();
      const response = await fetch('/api/public-chat/messages', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subroom_id: state.activeSubroom.subroom_id,
          before: before || null,
          limit: PAGE_SIZE
        })
      });
      const data = await response.json().catch(() => ({}));
      if(!response.ok || data.status === 'error') throw new Error(data.message || 'โหลดข้อความไม่สำเร็จ');

      state.hasMore = Boolean(data.has_more);
      if(before){
        prependMessages(data.messages || []);
      } else {
        state.messages = [];
        state.messageIds = new Set();
        (data.messages || []).forEach(message => {
          state.messageIds.add(message.chat_id);
          state.messages.push(message);
        });
        renderMessages();
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
      if(data.subroom) {
        state.activeSubroom = { ...state.activeSubroom, ...data.subroom };
        updateHeader(state.activeSubroom);
      }
    } catch (error) {
      console.error(error);
      if(!before) setMessageState(error.message || 'โหลดข้อความไม่สำเร็จ', 'chat-state error');
    } finally {
      state.loadingHistory = false;
    }
  }

  async function openSubroom(subroom){
    state.activeSubroom = subroom;
    state.messages = [];
    state.messageIds = new Set();
    state.hasMore = true;
    state.typingUsers.clear();
    setTypingBar();
    updateHeader(subroom);
    setMessageState('กำลังโหลด...', 'chat-state');
    document.querySelectorAll('.channel').forEach(el => {
      el.classList.toggle('active', el.dataset.subroomId === subroom.subroom_id);
    });
    if(typeof setMobileView === 'function') setMobileView('chat');
    await loadHistory();
    connectWebSocket();
    await pingPresence();
    startPresenceTimer();
  }

  async function uploadAttachment(){
    if(!state.selectedAttachment || !state.activeSubroom) return '';
    const headers = await authHeaders();
    const formData = new FormData();
    formData.append('subroom_id', state.activeSubroom.subroom_id);
    formData.append('attachment', state.selectedAttachment);
    const response = await fetch('/api/public-chat/attachments', {
      method: 'POST',
      headers,
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if(!response.ok || data.status === 'error') throw new Error(data.message || 'อัปโหลดไฟล์ไม่สำเร็จ');
    return data.attachment_url || '';
  }

  async function submitMessage(event){
    if(event && typeof event.preventDefault === 'function') event.preventDefault();
    if(!state.activeSubroom) return;
    const text = getPlainComposerText(true);
    if(!text && !state.selectedAttachment) return;
    try {
      let attachmentUrl = '';
      if(state.selectedAttachment) attachmentUrl = await uploadAttachment();
      await sendProtectedWs('message', {
        subroom_id: state.activeSubroom.subroom_id,
        message: text,
        attachment_url: attachmentUrl
      });
      await sendProtectedWs('stop_typing', { subroom_id: state.activeSubroom.subroom_id });
      state.isTyping = false;
      state.selectedAttachment = null;
      if(attachmentInput) attachmentInput.value = '';
      if(attachBtn) attachBtn.textContent = 'ไฟล์';
      setComposerPlainText('');
    } catch (error) {
      console.error(error);
      setMessageState(error.message || 'ส่งข้อความไม่สำเร็จ', 'chat-state error');
      renderMessages();
    }
  }

  async function handleTypingInput(){
    if(!state.activeSubroom) return;
    const hasText = Boolean(getPlainComposerText(true));
    window.clearTimeout(state.typingTimer);
    if(hasText && !state.isTyping){
      state.isTyping = true;
      await sendProtectedWs('start_typing', { subroom_id: state.activeSubroom.subroom_id }).catch(() => {});
    }
    if(!hasText && state.isTyping){
      state.isTyping = false;
      await sendProtectedWs('stop_typing', { subroom_id: state.activeSubroom.subroom_id }).catch(() => {});
      return;
    }
    if(hasText){
      state.typingTimer = window.setTimeout(async () => {
        state.isTyping = false;
        await sendProtectedWs('stop_typing', { subroom_id: state.activeSubroom.subroom_id }).catch(() => {});
      }, TYPING_IDLE_MS);
    }
  }

  function handlePaste(event){
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  function handleReplyClick(event){
    const button = event.target.closest('.public-reply-btn');
    if(!button) return;
    const nick = button.dataset.replyUser || '';
    if(!nick) return;

    let currentText = getPlainComposerText(false);
    currentText = currentText.replace(/^([^:\n]{1,60})\s:\s/, '');
    setComposerPlainText(`${nick} : ${currentText}`);
  }

  function setupEvents(){
    composerForm?.addEventListener('submit', submitMessage);
    composerInput?.addEventListener('input', handleTypingInput);
    composerInput?.addEventListener('paste', handlePaste);
    composerInput?.addEventListener('keydown', (event) => {
      if(event.key === 'Enter' && !event.shiftKey){
        event.preventDefault();
        submitMessage(event);
      }
    });

    messagesEl?.addEventListener('click', (event) => {
      handleReplyClick(event);
      const profileTrigger = event.target.closest('.user-profile-trigger');
      if(profileTrigger && typeof window.openProfileDrawer === 'function'){
        const ds = profileTrigger.dataset;
        if(ds.profileNick){
          window.openProfileDrawer({
            nick: ds.profileNick,
            tag: ds.profileTag,
            avatar: ds.profileAvatar,
            profileId: ds.profileId,
            created_at: ds.profileDate,
            social_media: {
              facebook: ds.profileFacebook || '',
              instagram: ds.profileInstagram || ''
            }
          });
        }
      }
    });

    onlineListEl?.addEventListener('click', (event) => {
      const memberEl = event.target.closest('.user-profile-trigger');
      if(memberEl && typeof window.openProfileDrawer === 'function'){
        const ds = memberEl.dataset;
        if(ds.profileNick){
          window.openProfileDrawer({
            nick: ds.profileNick,
            tag: ds.profileTag,
            avatar: ds.profileAvatar,
            profileId: ds.profileId,
            created_at: ds.profileDate,
            social_media: {
              facebook: ds.profileFacebook || '',
              instagram: ds.profileInstagram || ''
            }
          });
        }
      }
    });

    const onlineSearchInput = document.querySelector('.online-panel-search input');
    onlineSearchInput?.addEventListener('input', () => {
      renderOnlineList();
    });

    messagesEl?.addEventListener('scroll', () => {
      if(messagesEl.scrollTop <= 24 && state.hasMore && state.messages.length && !state.loadingHistory){
        loadHistory(state.messages[0].created_at);
      }
    });

    /* ---- Mobile pull-down to load history ---- */
    (function setupPullToLoad(){
      let touchStartY = 0;
      let pulling = false;
      const PULL_THRESHOLD = 48; // px needed to trigger load

      // Inject indicator element into messages container
      const indicator = document.createElement('div');
      indicator.className = 'pull-load-indicator';
      indicator.innerHTML = '<div class="pull-spinner"></div><span>กำลังโหลดข้อความก่อนหน้า...</span>';
      messagesEl?.prepend(indicator);

      messagesEl?.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
        pulling = false;
      }, { passive: true });

      messagesEl?.addEventListener('touchmove', (e) => {
        if(!state.hasMore || state.loadingHistory || !state.messages.length) return;
        const deltaY = e.touches[0].clientY - touchStartY;
        if(deltaY > 0 && messagesEl.scrollTop <= 0){
          // User is pulling down at the very top
          pulling = true;
          indicator.classList.add('visible');
          e.preventDefault(); // block browser pull-to-refresh only when at top
        } else {
          indicator.classList.remove('visible');
        }
      }, { passive: false });

      messagesEl?.addEventListener('touchend', async () => {
        if(pulling && state.hasMore && !state.loadingHistory && state.messages.length){
          indicator.querySelector('span').textContent = 'กำลังโหลดข้อความก่อนหน้า...';
          await loadHistory(state.messages[0].created_at);
        }
        pulling = false;
        indicator.classList.remove('visible');
      }, { passive: true });
    })();

    attachBtn?.addEventListener('click', () => attachmentInput?.click());
    attachmentInput?.addEventListener('change', () => {
      state.selectedAttachment = attachmentInput.files?.[0] || null;
      attachBtn.textContent = state.selectedAttachment ? state.selectedAttachment.name.slice(0, 18) : 'ไฟล์';
    });
  }

  function setCurrentUser(user){
    state.currentUser = user || state.currentUser;
    if(user?.user_id) state.currentUserId = user.user_id;
  }

  function updateCurrentUserSnapshot(user){
    if(!user?.user_id) return;
    setCurrentUser(user);

    state.messages = state.messages.map(message => {
      if(message.user_owner_id !== user.user_id) return message;
      return {
        ...message,
        user_nick: user.user_nick || message.user_nick,
        user_uniname: user.user_uniname || message.user_uniname,
        user_profile_url: user.user_profile_url || message.user_profile_url,
        social_media: user.social_media || message.social_media,
        user_created_at: user.created_at || message.user_created_at
      };
    });

    state.allOnlineUsers = state.allOnlineUsers.map(member => {
      if(member.user_id !== user.user_id) return member;
      return {
        ...member,
        user_nick: user.user_nick || member.user_nick,
        user_uniname: user.user_uniname || member.user_uniname,
        user_profile_url: user.user_profile_url || member.user_profile_url,
        social_media: user.social_media || member.social_media,
        created_at: user.created_at || member.created_at
      };
    });

    renderMessages();
    renderOnlineList();
  }

  async function refreshIdentity(){
    state.currentUserId = await getCurrentUserId();
    if(window.LaanCurrentUser) setCurrentUser(window.LaanCurrentUser);
  }

  window.PublicChat = {
    getAccessHKey,
    authHeaders,
    openSubroom,
    setCurrentUser,
    updateCurrentUserSnapshot,
    refreshIdentity,
    applyPresence,
    updateUniversityOnline,
    get activeSubroom(){
      return state.activeSubroom;
    }
  };

  document.addEventListener('laan:user-ready', async (event) => {
    setCurrentUser(event.detail?.user);
    await refreshIdentity();
    if(typeof window.reloadActiveSubrooms === 'function') {
      window.reloadActiveSubrooms();
    }
  });

  setupEvents();
  refreshIdentity();
  renderMessages();
})();
