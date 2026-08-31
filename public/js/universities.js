/* Loads university data and renders both the rail buttons and onboarding select. */

const SUBROOM_GROUPS = {
  official: document.getElementById('officialRoomGroup'),
  community: document.getElementById('communityRoomGroup'),
  temp: document.getElementById('tempRoomGroup')
};

let activeUniversityName = '';
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

function formatSubroomName(name){
  const value = typeof name === 'string' ? name.trim() : '';
  if(!value) return '#ไม่ระบุชื่อห้อง';
  return value.startsWith('#') ? value : `#${value}`;
}

function renderSubroomChannel(subroom){
  const channel = document.createElement('div');
  channel.className = 'channel';
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
  countSpan.className = 'channel-count zero';
  countSpan.textContent = '• 0 คน';
  stats.appendChild(countSpan);

  top.appendChild(nameSpan);
  top.appendChild(stats);

  const descSpan = document.createElement('span');
  descSpan.className = 'channel-desc';
  descSpan.textContent = subroom.subroom_desc || '';

  channel.appendChild(top);
  channel.appendChild(descSpan);
  channel.addEventListener('click', () => {
    if(typeof setMobileView === 'function') setMobileView('chat');
  });

  return channel;
}

function renderSubroomGroups(subroomsByType){
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
      fragment.appendChild(renderSubroomChannel(subroom));
    });
    group.appendChild(fragment);
  });
}

async function loadSubroomsForUniversity(uniroomName){
  activeUniversityName = typeof uniroomName === 'string' ? uniroomName.trim() : '';
  updateRailUniversity(activeUniversityName || 'มหาวิทยาลัย');

  if(!activeUniversityName){
    Object.keys(SUBROOM_GROUPS).forEach(type => {
      setSubroomGroupMessage(type, getSubroomEmptyMessage(type), 'channel-state empty');
    });
    return;
  }

  const requestId = ++activeSubroomRequest;
  setAllSubroomGroupsLoading();

  try {
    const params = new URLSearchParams({ uniroom_name: activeUniversityName });
    const response = await fetch(`/api/subrooms?${params.toString()}`);
    const data = await response.json().catch(() => ({}));

    if(requestId !== activeSubroomRequest) return;

    if(!response.ok || data.status === 'error'){
      throw new Error(data.message || 'ไม่สามารถโหลดห้องย่อยได้');
    }

    renderSubroomGroups(data.subrooms || {});
  } catch (error) {
    console.error(error);
    if(requestId !== activeSubroomRequest) return;

    Object.keys(SUBROOM_GROUPS).forEach(type => {
      setSubroomGroupMessage(type, 'โหลดห้องย่อยไม่สำเร็จ', 'channel-state error');
    });
  }
}

function selectUniversity(button){
  document.querySelectorAll('.uni-icon').forEach(el => {
    el.classList.toggle('active', el === button);
  });
  loadSubroomsForUniversity(button.dataset.name);
  document.body.classList.remove('nav-open');
}

// Rebuilds the university rail from API data while keeping the add button at the end.
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

// Replaces the native select UI with the styled searchable-looking dropdown used on startup.
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

// Keeps the startup university select in sync with the same API source as the rail.
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

// Loads available universities once on page load and renders every university picker.
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

window.reloadActiveSubrooms = function(){
  return loadSubroomsForUniversity(activeUniversityName);
};
