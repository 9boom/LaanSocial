/* Handles reusable app modals: add university, temporary room, notifications, and reports. */

/* ---------- ADD UNIVERSITY MODAL ---------- */
const openAddUniBtn   = document.getElementById('openAddUniBtn');
const adduniOverlay   = document.getElementById('adduniOverlay');
const adduniFormView  = document.getElementById('adduniFormView');
const adduniSuccessView = document.getElementById('adduniSuccessView');
const adduniForm      = document.getElementById('adduniForm');
const adduniNameField = document.getElementById('adduniNameField');
const adduniName      = document.getElementById('adduniName');
const adduniCancelBtn = document.getElementById('adduniCancelBtn');
const adduniOkBtn     = document.getElementById('adduniOkBtn');

// Restores the add-university modal to its input state before every open.
function resetAdduniForm(){
  adduniForm.reset();
  adduniNameField.classList.remove('invalid');
  adduniFormView.style.display = '';
  adduniSuccessView.style.display = 'none';
}

// Opens the shared add-university modal used by both rail and startup controls.
function openAddUniModal(){
  resetAdduniForm();
  adduniOverlay.classList.add('open');
}
function closeAddUniModal(){
  adduniOverlay.classList.remove('open');
}

openAddUniBtn.addEventListener('click', openAddUniModal);
adduniCancelBtn.addEventListener('click', closeAddUniModal);
adduniOkBtn.addEventListener('click', closeAddUniModal);
adduniOverlay.addEventListener('click', (e) => {
  if(e.target === adduniOverlay) closeAddUniModal();
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && adduniOverlay.classList.contains('open')) closeAddUniModal();
});

adduniForm.addEventListener('submit', function(e){
  e.preventDefault();
  if(!adduniName.value.trim()){
    adduniNameField.classList.add('invalid');
    adduniName.focus();
    return;
  }
  adduniNameField.classList.remove('invalid');
  adduniFormView.style.display = 'none';
  adduniSuccessView.style.display = '';
});

/* ---------- ADD TEMPORARY ROOM MODAL ---------- */
const openAddTempRoomBtn = document.getElementById('openAddTempRoomBtn');
const addtemproomOverlay = document.getElementById('addtemproomOverlay');
const addtemproomForm    = document.getElementById('addtemproomForm');
const addtemproomNameField = document.getElementById('addtemproomNameField');
const addtemproomName    = document.getElementById('addtemproomName');
const addtemproomDesc    = document.getElementById('addtemproomDesc');
const addtemproomAge     = document.getElementById('addtemproomAge');
const addtemproomCancelBtn = document.getElementById('addtemproomCancelBtn');
const addtemproomSubmitBtn = addtemproomForm.querySelector('button[type="submit"]');
const addtemproomError = document.createElement('p');
addtemproomError.className = 'adduni-error';
addtemproomError.setAttribute('aria-live', 'polite');
addtemproomError.hidden = true;
addtemproomForm.querySelector('.adduni-actions').insertAdjacentElement('beforebegin', addtemproomError);

function resetAddTempRoomForm(){
  addtemproomForm.reset();
  addtemproomNameField.classList.remove('invalid');
  setAddTempRoomError('');
  setAddTempRoomLoading(false);
}
function setAddTempRoomError(message){
  addtemproomError.textContent = message || '';
  addtemproomError.hidden = !message;
}
function setAddTempRoomLoading(isLoading){
  if(!addtemproomSubmitBtn) return;
  if(!addtemproomSubmitBtn.dataset.idleText) addtemproomSubmitBtn.dataset.idleText = addtemproomSubmitBtn.textContent;
  addtemproomSubmitBtn.disabled = isLoading;
  addtemproomSubmitBtn.classList.toggle('is-loading', isLoading);
  addtemproomSubmitBtn.textContent = isLoading ? 'กำลังส่ง...' : addtemproomSubmitBtn.dataset.idleText;
}
function openAddTempRoomModal(){
  resetAddTempRoomForm();
  addtemproomOverlay.classList.add('open');
}
function closeAddTempRoomModal(){
  addtemproomOverlay.classList.remove('open');
}

openAddTempRoomBtn.addEventListener('click', openAddTempRoomModal);
addtemproomCancelBtn.addEventListener('click', closeAddTempRoomModal);
addtemproomOverlay.addEventListener('click', (e) => {
  if(e.target === addtemproomOverlay) closeAddTempRoomModal();
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && addtemproomOverlay.classList.contains('open')) closeAddTempRoomModal();
  });

function validateTempRoomName(name){
  if(!name) return 'กรุณากรอกชื่อห้อง';
  if(name.length > 25) return 'ชื่อห้องต้องไม่เกิน 25 ตัวอักษร';
  return '';
}

addtemproomForm.addEventListener('submit', async function(e){
  e.preventDefault();
  const name = addtemproomName.value.trim();
  const nameError = validateTempRoomName(name);
  if(nameError){
    addtemproomNameField.classList.add('invalid');
    setAddTempRoomError(nameError);
    addtemproomName.focus();
    return;
  }

  addtemproomNameField.classList.remove('invalid');
  setAddTempRoomError('');

  const uniroomName = typeof window.getActiveUniversityName === 'function' ? window.getActiveUniversityName() : '';
  if(!uniroomName){
    setAddTempRoomError('กรุณาเลือกมหาวิทยาลัยก่อนสร้างห้อง');
    return;
  }

  setAddTempRoomLoading(true);

  try {
    const headers = window.PublicChat ? await window.PublicChat.authHeaders() : {};
    const response = await fetch('/add-subroom', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        uniroom_name: uniroomName,
        subroom_name: name,
        subroom_desc: addtemproomDesc.value.trim(),
        expire_days: Number(addtemproomAge.value)
      })
    });
    const data = await response.json().catch(() => ({}));

    if(!response.ok || data.status === 'error'){
      throw new Error(data.message || 'สร้างห้องไม่สำเร็จ');
    }

    if(typeof window.reloadActiveSubrooms === 'function') {
      await window.reloadActiveSubrooms();
    }
    closeAddTempRoomModal();
  } catch (error) {
    console.error(error);
    setAddTempRoomError(error.message || 'สร้างห้องไม่สำเร็จ');
  } finally {
    setAddTempRoomLoading(false);
  }
});

addtemproomName.addEventListener('input', () => {
  const name = addtemproomName.value.trim();
  const message = name.length > 25 ? 'ชื่อห้องต้องไม่เกิน 25 ตัวอักษร' : '';
  addtemproomNameField.classList.toggle('invalid', Boolean(message));
  setAddTempRoomError(message);
});

/* ---------- ASK FOR NOTIFICATION MODAL ---------- */
const notifBellBtn  = document.getElementById('notifBellBtn');
const notifOverlay  = document.getElementById('notifOverlay');
const notifAllowBtn = document.getElementById('notifAllowBtn');

function openNotifModal(){
  notifOverlay.classList.add('open');
}
function closeNotifModal(){
  notifOverlay.classList.remove('open');
}

if (notifBellBtn) notifBellBtn.addEventListener('click', openNotifModal);
notifAllowBtn.addEventListener('click', closeNotifModal);
notifOverlay.addEventListener('click', (e) => {
  if(e.target === notifOverlay) closeNotifModal();
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && notifOverlay.classList.contains('open')) closeNotifModal();
});

/* ---------- REPORT CONTENT MODAL ---------- */
const reportOverlay    = document.getElementById('reportOverlay');
const reportFormView   = document.getElementById('reportFormView');
const reportSuccessView= document.getElementById('reportSuccessView');
const reportForm       = document.getElementById('reportForm');
const reportTitle      = document.getElementById('reportTitle');
const reportTargetName = document.getElementById('reportTargetName');
const reportOptions    = document.getElementById('reportOptions');
const reportOtherText  = document.getElementById('reportOtherText');
const reportCancelBtn  = document.getElementById('reportCancelBtn');
const reportOkBtn      = document.getElementById('reportOkBtn');
const reportSubmitBtn  = reportForm?.querySelector('button[type="submit"]');

let currentReportContext = null;

// Clears report choices and returns the report modal to its form view.
function resetReportForm(){
  reportForm.reset();
  reportOptions.classList.remove('invalid');
  if(reportSubmitBtn){
    reportSubmitBtn.disabled = false;
    reportSubmitBtn.textContent = 'รายงาน';
  }
  reportFormView.style.display = '';
  reportSuccessView.style.display = 'none';
}

// Opens the report modal with context: { target_type, chat_id, target_user_id, tag, name } or (tag, name)
function openReportModal(contextOrTag, maybeName){
  resetReportForm();

  if(typeof contextOrTag === 'object' && contextOrTag !== null){
    currentReportContext = {
      target_type: contextOrTag.target_type || 'chat',
      chat_id: contextOrTag.chat_id || '',
      target_user_id: contextOrTag.target_user_id || '',
      tag: contextOrTag.tag || '',
      name: contextOrTag.name || ''
    };
  } else {
    currentReportContext = {
      target_type: 'chat',
      chat_id: '',
      target_user_id: '',
      tag: contextOrTag || '',
      name: maybeName || ''
    };
  }

  if(reportTitle){
    reportTitle.textContent = currentReportContext.target_type === 'profile'
      ? 'รายงานผู้ใช้งานที่ไม่เหมาะสม'
      : 'รายงานเนื้อหาการสนทนาที่ไม่เหมาะสม';
  }

  const displayName = `${currentReportContext.tag} ${currentReportContext.name}`.trim();
  reportTargetName.textContent = displayName || 'ผู้ใช้งาน';
  reportOverlay.classList.add('open');
}

function closeReportModal(){
  reportOverlay.classList.remove('open');
  currentReportContext = null;
}

window.openReportModal = openReportModal;
window.closeReportModal = closeReportModal;

// event delegation: works for both static messages and dynamically-rendered private chat messages
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.report-trigger');
  if(!btn || btn.disabled || btn.classList.contains('reported')) return;
  openReportModal({
    target_type: btn.dataset.reportType || 'chat',
    chat_id: btn.dataset.reportChatId || '',
    target_user_id: btn.dataset.reportUserId || '',
    tag: btn.dataset.reportTag || '',
    name: btn.dataset.reportName || ''
  });
});

reportCancelBtn.addEventListener('click', closeReportModal);
reportOkBtn.addEventListener('click', closeReportModal);
reportOverlay.addEventListener('click', (e) => {
  if(e.target === reportOverlay) closeReportModal();
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && reportOverlay.classList.contains('open')) closeReportModal();
});

async function getAuthHeaders() {
  if(window.PublicChat && typeof window.PublicChat.authHeaders === 'function'){
    return await window.PublicChat.authHeaders();
  }
  if(window.IDBStorage){
    const currentUserId = await window.IDBStorage.getItem('current_loggedin');
    if(currentUserId){
      const accessKey = await window.IDBStorage.getItem(`access_key_${currentUserId}`);
      if(accessKey) return { 'X-Access-HKey': accessKey };
    }
  }
  return {};
}

reportForm.addEventListener('submit', async function(e){
  e.preventDefault();
  const selected = reportForm.querySelector('input[name="reportReason"]:checked');
  if(!selected){
    reportOptions.classList.add('invalid');
    return;
  }
  reportOptions.classList.remove('invalid');

  if(!currentReportContext){
    closeReportModal();
    return;
  }

  const reasonType = selected.value;
  const otherReason = reportOtherText ? reportOtherText.value.trim() : '';

  try {
    if(reportSubmitBtn){
      reportSubmitBtn.disabled = true;
      reportSubmitBtn.textContent = 'กำลังส่งรายงาน...';
    }

    const headers = await getAuthHeaders();
    headers['Content-Type'] = 'application/json';

    const payload = {
      target_type: currentReportContext.target_type,
      chat_id: currentReportContext.chat_id,
      target_user_id: currentReportContext.target_user_id,
      reason_type: reasonType,
      other_reason: otherReason
    };

    const response = await fetch('/api/reports', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if(!response.ok){
      if(response.status === 409 || data?.code === 'already_reported'){
        if(currentReportContext.target_type === 'chat' && currentReportContext.chat_id){
          if(window.LaanCurrentUser){
            const list = Array.isArray(window.LaanCurrentUser.reported_chat) ? window.LaanCurrentUser.reported_chat : [];
            if(!list.includes(currentReportContext.chat_id)) list.push(currentReportContext.chat_id);
            window.LaanCurrentUser.reported_chat = list;
          }
        } else if(currentReportContext.target_type === 'profile' && currentReportContext.target_user_id){
          if(window.LaanCurrentUser){
            const list = Array.isArray(window.LaanCurrentUser.reported_profile) ? window.LaanCurrentUser.reported_profile : [];
            if(!list.includes(currentReportContext.target_user_id)) list.push(currentReportContext.target_user_id);
            window.LaanCurrentUser.reported_profile = list;
          }
        }
        if(window.PublicChat && typeof window.PublicChat.renderMessages === 'function'){
          window.PublicChat.renderMessages();
        }
        alert('คุณได้รายงานเนื้อหานี้ไปแล้ว');
        closeReportModal();
        return;
      }
      throw new Error(data?.message || 'ส่งรายงานไม่สำเร็จ');
    }

    // Success: update current user state
    if(window.LaanCurrentUser){
      if(Array.isArray(data.reported_chat)){
        window.LaanCurrentUser.reported_chat = data.reported_chat;
      }
      if(Array.isArray(data.reported_profile)){
        window.LaanCurrentUser.reported_profile = data.reported_profile;
      }
    }

    if(window.PublicChat && typeof window.PublicChat.renderMessages === 'function'){
      window.PublicChat.renderMessages();
    }

    reportFormView.style.display = 'none';
    reportSuccessView.style.display = '';
  } catch (error) {
    console.error('Report submission error:', error);
    alert(error.message || 'ส่งรายงานไม่สำเร็จ');
    if(reportSubmitBtn){
      reportSubmitBtn.disabled = false;
      reportSubmitBtn.textContent = 'รายงาน';
    }
  }
});

/* ---------- ROOM INFO MODAL ---------- */
const infoBtn          = document.getElementById('infoBtn');
const roomInfoOverlay  = document.getElementById('roomInfoOverlay');
const closeRoomInfoBtn = document.getElementById('closeRoomInfoBtn');
const roomInfoOkBtn    = document.getElementById('roomInfoOkBtn');

function openRoomInfoModal(){
  if(roomInfoOverlay) roomInfoOverlay.classList.add('open');
}
function closeRoomInfoModal(){
  if(roomInfoOverlay) roomInfoOverlay.classList.remove('open');
}

if(infoBtn) infoBtn.addEventListener('click', openRoomInfoModal);
if(closeRoomInfoBtn) closeRoomInfoBtn.addEventListener('click', closeRoomInfoModal);
if(roomInfoOkBtn) roomInfoOkBtn.addEventListener('click', closeRoomInfoModal);
if(roomInfoOverlay){
  roomInfoOverlay.addEventListener('click', (e) => {
    if(e.target === roomInfoOverlay) closeRoomInfoModal();
  });
}
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && roomInfoOverlay && roomInfoOverlay.classList.contains('open')){
    closeRoomInfoModal();
  }
});

