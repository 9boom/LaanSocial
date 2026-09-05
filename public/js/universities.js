/* Loads university data and renders rail buttons, onboarding select, and real subrooms. */

const SUBROOM_GROUPS = {
  official: document.getElementById('officialRoomGroup'),
  community: document.getElementById('communityRoomGroup'),
  temp: document.getElementById('tempRoomGroup')
};

let activeUniversityName = '';
let activeUniversity = null;
let activeSubroomRequest = 0;

function updateRailUniversity(name){
  const sidebarTitle = document.querySelector('.uni-card h2');
  if(sidebarTitle) sidebarTitle.textContent = name;
}

function getSubroomEmptyMessage(type){
  if(type === 'official') return 'ยังไม่มีห้องทางการ';
  if(type === 'community') return 'ยังไม่มีชุมชนถาวร';
  return 'ยังไม่มีชุมชนชั่วคราว';
}

function setSubroomGroupMessage(type, message, className){
  const group = SUBROOM_GROUPS[type];
  if(!group) return;

  group.textContent = '';
  const state = document.createElement('p');
  state.className = className;
  state.textContent = message;
  group.appendChild(state);
}

function setAllSubroomGroupsLoading(){
  Object.keys(SUBROOM_GROUPS).forEach(type => {
    setSubroomGroupMessage(type, 'กำลังโหลด...', 'channel-state');
  });
}

const subroomCache = new Map();

function formatSubroomName(name){
  const value = typeof name === 'string' ? name.trim() : '';
  if(!value) return '#ไม่ระบุชื่อห้อง';
  return value.startsWith('#') ? value : `#${value}`;
}

const isMobileScreen = () => window.innerWidth <= 900;

function renderSubroomChannel(subroom, index = 0){
  const channel = document.createElement('div');
  channel.className = 'channel animate-in';
  channel.style.animationDelay = `${Math.min(index * 35, 280)}ms`;
  channel.dataset.subroomId = subroom.subroom_id || '';
  channel.dataset.subroomType = subroom.subroom_type || '';

  const top = document.createElement('div');
  top.className = 'channel-top';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'channel-name';
  nameSpan.textContent = formatSubroomName(subroom.subroom_name);

  const stats = document.createElement('div');
  stats.className = 'channel-stats';
  const countSpan = document.createElement('span');
  const count = Number(subroom.channel_count || 0);
  countSpan.className = `channel-count${count ? '' : ' zero'}`;
  countSpan.textContent = `• ${count} คน`;
  stats.appendChild(countSpan);

  top.appendChild(nameSpan);
  top.appendChild(stats);

  const descSpan = document.createElement('span');
  descSpan.className = 'channel-desc';
  descSpan.textContent = subroom.subroom_desc || '';

  channel.appendChild(top);
  channel.appendChild(descSpan);
  channel.addEventListener('click', () => {
    if(window.PublicChat && typeof window.PublicChat.openSubroom === 'function'){
      const latestSubroom = subroomCache.get(subroom.subroom_id) || subroom;
      window.PublicChat.openSubroom(latestSubroom);
    }
  });

  return channel;
}

function renderSubroomGroups(subroomsByType, preferredSubroomId){
  subroomCache.clear();
  const firstSubroom = [];
  let channelIndex = 0;

  Object.keys(SUBROOM_GROUPS).forEach(type => {
    const group = SUBROOM_GROUPS[type];
    if(!group) return;

    const subrooms = Array.isArray(subroomsByType?.[type]) ? subroomsByType[type] : [];
    group.textContent = '';

    if(!subrooms.length){
      setSubroomGroupMessage(type, getSubroomEmptyMessage(type), 'channel-state empty');
      return;
    }

    const fragment = document.createDocumentFragment();
    subrooms.forEach(subroom => {
      if(subroom && subroom.subroom_id){
        subroomCache.set(subroom.subroom_id, subroom);
      }
      if(!firstSubroom.length) firstSubroom.push(subroom);
      fragment.appendChild(renderSubroomChannel(subroom, channelIndex++));
    });
    group.appendChild(fragment);
  });

  const targetSubroom = (preferredSubroomId && subroomCache.get(preferredSubroomId)) || firstSubroom[0];
  if(targetSubroom && window.PublicChat && typeof window.PublicChat.openSubroom === 'function'){
    if(!isMobileScreen() || preferredSubroomId){
      window.PublicChat.openSubroom(targetSubroom);
    }
  }
}

async function loadSubroomsForUniversity(uniroomName, preferredSubroomId){
  activeUniversityName = typeof uniroomName === 'string' ? uniroomName.trim() : '';
  updateRailUniversity(activeUniversityName || 'มหาวิทยาลัย');

  if(!activeUniversityName){
    Object.keys(SUBROOM_GROUPS).forEach(type => {
      setSubroomGroupMessage(type, getSubroomEmptyMessage(type), 'channel-state empty');
    });
    return;
  }

  // Check if user is logged in before attempting to call authenticated API
  if(window.PublicChat && typeof window.PublicChat.getAccessHKey === 'function'){
    const accessKey = await window.PublicChat.getAccessHKey();
    if(!accessKey){
      Object.keys(SUBROOM_GROUPS).forEach(type => {
        setSubroomGroupMessage(type, 'กรุณาเข้าสู่ระบบเพื่อดูห้องย่อย', 'channel-state');
      });
      return;
    }
  }

  const requestId = ++activeSubroomRequest;
  setAllSubroomGroupsLoading();

  try {
    const params = new URLSearchParams({ uniroom_name: activeUniversityName });
    const headers = window.PublicChat ? await window.PublicChat.authHeaders() : {};
    const response = await fetch(`/api/subrooms?${params.toString()}`, { headers });
    const data = await response.json().catch(() => ({}));

    if(requestId !== activeSubroomRequest) return;

    if(!response.ok || data.status === 'error'){
      throw new Error(data.message || 'ไม่สามารถโหลดห้องย่อยได้');
    }

    activeUniversity = data.university || null;
    if(window.PublicChat && typeof window.PublicChat.updateUniversityOnline === 'function'){
      window.PublicChat.updateUniversityOnline(activeUniversity?.online_count || 0);
    }
    renderSubroomGroups(data.subrooms || {}, preferredSubroomId);
  } catch (error) {
    console.error(error);
    if(requestId !== activeSubroomRequest) return;

    Object.keys(SUBROOM_GROUPS).forEach(type => {
      setSubroomGroupMessage(type, error.message || 'โหลดห้องย่อยไม่สำเร็จ', 'channel-state error');
    });
  }
}

function selectUniversity(button){
  document.querySelectorAll('.uni-icon').forEach(el => {
    el.classList.toggle('active', el === button);
  });
  if(typeof setMobileView === 'function'){
    setMobileView('sidebar');
  }
  document.body.classList.remove('nav-open');
  loadSubroomsForUniversity(button.dataset.name);
}

function renderUniversityRail(universities){
  const rail = document.querySelector('.uni-rail');
  const addButton = document.getElementById('openAddUniBtn');
  if(!rail || !addButton) return;

  rail.querySelectorAll('.uni-icon').forEach(el => el.remove());

  const fragment = document.createDocumentFragment();
  universities.forEach((university, index) => {
    const displayName = university.displayName || university.name;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `uni-icon${index === 0 ? ' active' : ''}`;
    button.dataset.name = displayName;
    button.setAttribute('aria-label', displayName);

    const image = document.createElement('img');
    image.src = university.image;
    image.alt = displayName;
    button.appendChild(image);

    button.addEventListener('click', () => selectUniversity(button));
    fragment.appendChild(button);
  });

  rail.insertBefore(fragment, addButton);
  if(universities[0]) loadSubroomsForUniversity(universities[0].displayName || universities[0].name);
}

function setupStartupUniversityDropdown(select){
  if(!select || select.dataset.customReady) return;
  select.dataset.customReady = 'true';
  select.classList.add('is-customized');

  const placeholder = select.querySelector('option[value=""]')?.textContent || 'เลือกมหาวิทยาลัย';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = 'startupUniTrigger';
  trigger.className = 'startup-select-trigger';
  trigger.textContent = placeholder;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'startup-select-menu';
  menu.setAttribute('role', 'listbox');
  document.body.appendChild(menu);
  select.parentNode.insertBefore(trigger, select.nextSibling);

  const closeMenu = () => {
    menu.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  };
  const positionMenu = () => {
    const rect = trigger.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.width = `${rect.width}px`;
    menu.style.maxHeight = `${Math.max(160, Math.min(360, window.innerHeight - rect.bottom - 16))}px`;
  };
  const syncTrigger = () => {
    const selected = select.options[select.selectedIndex];
    trigger.textContent = select.value ? selected.textContent : placeholder;
    trigger.classList.toggle('has-value', Boolean(select.value));
  };
  const rebuildMenu = () => {
    menu.textContent = '';
    Array.from(select.options).forEach(option => {
      if(!option.value) return;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `startup-select-option${option.value === select.value ? ' active' : ''}`;
      item.textContent = option.textContent;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', option.value === select.value ? 'true' : 'false');
      item.addEventListener('click', () => {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles:true }));
        closeMenu();
        trigger.focus();
      });
      menu.appendChild(item);
    });
  };
  const openMenu = () => {
    rebuildMenu();
    positionMenu();
    menu.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
  };

  trigger.addEventListener('click', () => menu.classList.contains('open') ? closeMenu() : openMenu());
  document.addEventListener('click', (event) => {
    if(event.target !== trigger && !menu.contains(event.target)) closeMenu();
  });
  window.addEventListener('resize', () => {
    if(menu.classList.contains('open')) positionMenu();
  });
  window.addEventListener('scroll', () => {
    if(menu.classList.contains('open')) positionMenu();
  }, true);
  trigger.addEventListener('keydown', (event) => {
    if(event.key === 'Escape') closeMenu();
    if(event.key === 'Enter' || event.key === ' '){
      event.preventDefault();
      openMenu();
    }
  });
  select.addEventListener('change', () => {
    syncTrigger();
    rebuildMenu();
  });
  syncTrigger();
}

function renderUniversitySelect(universities){
  const select = document.getElementById('startupUni');
  if(!select) return;

  const placeholder = select.querySelector('option[value=""]');
  select.textContent = '';
  if(placeholder) select.appendChild(placeholder);

  universities.forEach(university => {
    const option = document.createElement('option');
    option.value = university.displayName || university.name;
    option.textContent = university.displayName || university.name;
    select.appendChild(option);
  });
  setupStartupUniversityDropdown(select);
}

async function initializeUniversities(){
  try {
    const response = await fetch('/api/universities');
    if(!response.ok) throw new Error(`Failed to load universities: ${response.status}`);
    const universities = await response.json();

    renderUniversityRail(universities);
    renderUniversitySelect(universities);
  } catch (error) {
    console.error(error);
  }
}

initializeUniversities();

window.getActiveUniversityName = function(){
  return activeUniversityName;
};

window.getActiveUniversity = function(){
  return activeUniversity;
};

window.updateCachedSubroom = function(subroomId, updates){
  if(!subroomId) return null;
  const current = subroomCache.get(subroomId) || {};
  const updated = { ...current, ...updates };
  subroomCache.set(subroomId, updated);
  return updated;
};

window.getCachedSubroom = function(subroomId){
  return subroomCache.get(subroomId) || null;
};

window.reloadActiveSubrooms = function(preferredSubroomId){
  const targetId = preferredSubroomId || window.PublicChat?.activeSubroom?.subroom_id;
  return loadSubroomsForUniversity(activeUniversityName, targetId);
};

document.addEventListener('laan:user-ready', (event) => {
  const user = event.detail?.user;
  if(user?.user_uniname){
    const targetBtn = Array.from(document.querySelectorAll('.uni-icon')).find(
      btn => btn.dataset.name === user.user_uniname
    );
    if(targetBtn){
      document.querySelectorAll('.uni-icon').forEach(el => {
        el.classList.toggle('active', el === targetBtn);
      });
      activeUniversityName = user.user_uniname;
    }
  }
});
