/* Renders private chat mock data, history, profile actions, and private message sending. */

const generalPanel      = document.getElementById('generalPanel');
const privateChatPanel  = document.getElementById('privateChatPanel');
const privateMessagesEl = document.getElementById('privateMessages');
const privateTagEl      = document.getElementById('privateTag');
const privateNameEl     = document.getElementById('privateName');
const privateComposerForm = document.getElementById('privateComposerForm');
const privateComposerInput = privateComposerForm.querySelector('input[type="text"]');

const channelSidebarView = document.getElementById('channelSidebarView');
const privateSidebarView = document.getElementById('privateSidebarView');
const privateHistoryList = document.getElementById('privateHistoryList');
const topPrivateBtn      = document.getElementById('topPrivateBtn');
let privateReturnMobileView = document.body.dataset.mobileView || 'sidebar';
let privateEntryMode = null;

const profilePanel      = document.getElementById('profilePanel');
const profileAvatarImg  = document.getElementById('profileAvatarImg');
const profileTagEl      = document.getElementById('profileTag');
const profileNameEl     = document.getElementById('profileName');
const profileJoinDateEl = document.getElementById('profileJoinDate');
const profileIdValEl    = document.getElementById('profileIdVal');
const profileNotifBtn   = document.getElementById('profileNotifBtn');

// Converts a message object into the DOM markup used by the private chat thread.
function renderPrivateMessage(contact, m){
  const avatar = m.mine ? MY_AVATAR : contact.avatar;
  const metaHTML = m.mine
    ? `<span class="time">${m.time}</span><span class="tag">${MY_TAG}</span><span>${MY_NAME}</span>`
    : `<span class="tag user-trigger" data-contact="${privateChatPanel.dataset.activeContact}">${contact.tag}</span><span class="user-trigger" data-contact="${privateChatPanel.dataset.activeContact}">${contact.name}</span><span class="time">${m.time}</span>
       <div class="msg-actions">
         <button class="msg-action report-trigger" data-report-tag="${contact.tag}" data-report-name="${contact.name}"><img src="assets/symbols/report.svg" alt="">รายงาน</button>
       </div>`;
  return `<div class="msg${m.mine ? ' own' : ''}">
    <img class="avatar user-trigger" src="${avatar}" alt="" data-contact="${!m.mine ? privateChatPanel.dataset.activeContact : ''}">
    <div class="msg-body">
      <div class="msg-meta">${metaHTML}</div>
      <p class="msg-text">${m.text}</p>
    </div>
  </div>`;
}

// Rebuilds the private-message sidebar and wires each contact back into chat opening.
function renderPrivateHistoryList(activeKey){
  privateHistoryList.innerHTML = Object.keys(contacts).map(key => {
    const c = contacts[key];
    const hasBadge = c.unread > 0;
    return `<div class="private-history-item${key === activeKey ? ' active' : ''}${hasBadge ? ' has-badge' : ''}" data-contact="${key}">
      <div class="private-history-avatar-wrap">
        <img src="${c.avatar}" alt="${c.name}">
        ${c.online ? '<span class="private-history-online-dot"></span>' : ''}
      </div>
      <span class="private-history-name"><span class="tag">${c.tag}</span> ${c.name}</span>
      ${hasBadge ? `<span class="unread-badge">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}
    </div>`;
  }).join('');

  privateHistoryList.querySelectorAll('.private-history-item[data-contact]').forEach(el => {
    el.addEventListener('click', () => openPrivateChat(el.dataset.contact, {
      entryMode:'history',
      preserveReturn:true
    }));
  });
}

// Applies the current contact state to profile actions and the private composer.
function updateProfileActionButtons(contact){
  profileNotifBtn.textContent = contact.notifOn ? 'ปิดการแจ้งเตือน' : 'เปิดการแจ้งเตือน';
  profileNotifBtn.classList.toggle('is-on', contact.notifOn);
  privateComposerInput.disabled = contact.blocked;
  privateComposerInput.placeholder = contact.blocked ? 'คุณได้บล็อกผู้ใช้นี้แล้ว' : 'พิมข้อความ...';
}

// Opens the private-history pane from the top navigation button.
function showPrivateHistory(){
  closeOnlinePanel();
  privateReturnMobileView = document.body.dataset.mobileView || 'sidebar';
  privateEntryMode = 'history';
  showPrivateHistoryPane();
}

// Switches the shell into history mode without selecting a specific contact.
function showPrivateHistoryPane(){
  generalPanel.style.display = 'flex';
  privateChatPanel.style.display = 'none';
  profilePanel.classList.remove('open');
  channelSidebarView.style.display = 'none';
  privateSidebarView.style.display = 'flex';
  topPrivateBtn.classList.add('active');

  delete privateChatPanel.dataset.activeContact;
  renderPrivateHistoryList(null);
  setMobileView('sidebar');
}

// Opens a private conversation and synchronizes header, messages, profile, and mobile view.
function openPrivateChat(key, options = {}){
  const contact = contacts[key];
  if(!contact) return;
  const entryMode = options.entryMode || 'direct';
  if(!options.preserveReturn){
    privateReturnMobileView = document.body.dataset.mobileView || 'chat';
  }
  privateEntryMode = entryMode;

  closeOnlinePanel();
  contact.unread = 0;

  // header
  privateTagEl.textContent = contact.tag;
  privateNameEl.textContent = contact.name;

  // messages
  if(contact.messages.length){
    privateMessagesEl.innerHTML = contact.messages.map(m => renderPrivateMessage(contact, m)).join('');
  } else {
    privateMessagesEl.innerHTML = `<p class="private-empty">ยังไม่มีข้อความ พิมพ์เพื่อเริ่มบทสนทนากับ ${contact.tag} ${contact.name}</p>`;
  }

  // profile panel
  profileAvatarImg.src = contact.avatar;
  profileAvatarImg.alt = contact.name;
  profileTagEl.textContent = contact.tag;
  profileNameEl.textContent = contact.name;
  profileJoinDateEl.textContent = contact.joinDate;
  profileIdValEl.textContent = contact.profileId;
  updateProfileActionButtons(contact);

  generalPanel.style.display = 'none';
  privateChatPanel.style.display = 'flex';
  profilePanel.classList.add('open');
  channelSidebarView.style.display = 'none';
  privateSidebarView.style.display = 'flex';
  topPrivateBtn.classList.add('active');

  privateChatPanel.dataset.activeContact = key;
  renderPrivateHistoryList(key);
  privateMessagesEl.scrollTop = privateMessagesEl.scrollHeight;
  setMobileView('chat');
}

// Returns from private-message mode back to the public channel shell.
function closePrivateMode(){
  const returnView = privateReturnMobileView || 'chat';
  privateChatPanel.style.display = 'none';
  generalPanel.style.display = 'flex';
  profilePanel.classList.remove('open');
  channelSidebarView.style.display = 'flex';
  privateSidebarView.style.display = 'none';
  topPrivateBtn.classList.remove('active');
  delete privateChatPanel.dataset.activeContact;
  privateEntryMode = null;
  setMobileView(returnView);
}

// Chooses the correct back behavior depending on whether the user entered from history.
function leavePrivateChat(){
  if(privateEntryMode === 'history'){
    showPrivateHistoryPane();
  } else {
    closePrivateMode();
  }
}

// Tooltip functionality for user profiles in chat messages
const privateChatTooltip = document.getElementById('privateChatTooltip');
const privateChatTooltipBtn = document.getElementById('privateChatTooltipBtn');
let tooltipTimeoutId = null;
let currentTooltipContactKey = null;

function showPrivateChatTooltip(trigger){
  const contactKey = trigger.dataset.contact;
  if(!contactKey) return;
  
  currentTooltipContactKey = contactKey;
  const rect = trigger.getBoundingClientRect();
  
  // Position tooltip below the trigger element
  const tooltipTop = rect.bottom + 8;
  const tooltipLeft = rect.left + (rect.width / 2);
  
  privateChatTooltip.style.top = tooltipTop + 'px';
  privateChatTooltip.style.left = tooltipLeft + 'px';
  privateChatTooltip.style.transform = 'translateX(-50%)';
  
  privateChatTooltip.classList.add('active');
}

function hidePrivateChatTooltip(){
  privateChatTooltip.classList.remove('active');
  currentTooltipContactKey = null;
}

// Attach hover listeners to user triggers in messages using event delegation
const privateMessagesContainer = document.getElementById('privateMessages');
if(privateMessagesContainer){
  privateMessagesContainer.addEventListener('mouseenter', (e) => {
    const trigger = e.target.closest('.user-trigger[data-contact]');
    if(trigger){
      clearTimeout(tooltipTimeoutId);
      showPrivateChatTooltip(trigger);
    }
  }, true);
  
  privateMessagesContainer.addEventListener('mouseleave', (e) => {
    const trigger = e.target.closest('.user-trigger[data-contact]');
    if(trigger){
      tooltipTimeoutId = setTimeout(hidePrivateChatTooltip, 100);
    }
  }, true);
}

// Tooltip button click handler
if(privateChatTooltipBtn){
  privateChatTooltipBtn.addEventListener('click', () => {
    if(currentTooltipContactKey){
      openPrivateChat(currentTooltipContactKey, { entryMode:'direct' });
      hidePrivateChatTooltip();
    }
  });
}

// Hide tooltip when clicking elsewhere
document.addEventListener('click', (e) => {
  if(!privateChatTooltip.contains(e.target) && !e.target.closest('.user-trigger[data-contact]')){
    hidePrivateChatTooltip();
  }
});

document.querySelectorAll('.user-trigger[data-contact]').forEach(el => {
  el.addEventListener('click', () => openPrivateChat(el.dataset.contact, { entryMode:'direct' }));
});
document.querySelectorAll('.online-member[data-contact]').forEach(el => {
  el.addEventListener('click', () => openPrivateChat(el.dataset.contact, { entryMode:'direct' }));
});

topPrivateBtn.addEventListener('click', () => {
  if(privateEntryMode){
    closePrivateMode();
  } else {
    showPrivateHistory();
  }
});

document.getElementById('backToChannelsBtn').addEventListener('click', closePrivateMode);
document.getElementById('backToListBtnPrivate').addEventListener('click', leavePrivateChat);

profileNotifBtn.addEventListener('click', () => {
  const key = privateChatPanel.dataset.activeContact;
  if(!key) return;
  const contact = contacts[key];
  contact.notifOn = !contact.notifOn;
  updateProfileActionButtons(contact);
});

privateComposerForm.addEventListener('submit', function(e){
  e.preventDefault();
  const key = privateChatPanel.dataset.activeContact;
  if(!key) return;
  const contact = contacts[key];
  if(contact.blocked) return;
  const input = privateComposerInput;
  const text = input.value.trim();
  if(!text) return;
  const now = new Date();
  const time = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  contact.messages.push({mine:true, time, text});
  privateMessagesEl.innerHTML = contact.messages.map(m => renderPrivateMessage(contact, m)).join('');
  privateMessagesEl.scrollTop = privateMessagesEl.scrollHeight;
  input.value = '';
});
