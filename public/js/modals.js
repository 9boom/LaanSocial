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

notifBellBtn.addEventListener('click', openNotifModal);
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
const reportTargetName = document.getElementById('reportTargetName');
const reportOptions    = document.getElementById('reportOptions');
const reportOtherText  = document.getElementById('reportOtherText');
const reportCancelBtn  = document.getElementById('reportCancelBtn');
const reportOkBtn      = document.getElementById('reportOkBtn');

// Clears report choices and returns the report modal to its form view.
function resetReportForm(){
  reportForm.reset();
  reportOptions.classList.remove('invalid');
  reportFormView.style.display = '';
  reportSuccessView.style.display = 'none';
}

// Opens the report modal with the selected user's tag/name as context.
function openReportModal(tag, name){
  resetReportForm();
  reportTargetName.textContent = `${tag} ${name}`.trim();
  reportOverlay.classList.add('open');
}
function closeReportModal(){
  reportOverlay.classList.remove('open');
}

// event delegation: works for both static messages and dynamically-rendered private chat messages
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.report-trigger');
  if(!btn) return;
  openReportModal(btn.dataset.reportTag || '', btn.dataset.reportName || '');
});

reportCancelBtn.addEventListener('click', closeReportModal);
reportOkBtn.addEventListener('click', closeReportModal);
reportOverlay.addEventListener('click', (e) => {
  if(e.target === reportOverlay) closeReportModal();
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && reportOverlay.classList.contains('open')) closeReportModal();
});

reportForm.addEventListener('submit', function(e){
  e.preventDefault();
  const selected = reportForm.querySelector('input[name="reportReason"]:checked');
  if(!selected){
    reportOptions.classList.add('invalid');
    return;
  }
  reportOptions.classList.remove('invalid');
  reportFormView.style.display = 'none';
  reportSuccessView.style.display = '';
});
