/* Loads university data and renders both the rail buttons and onboarding select. */

function updateRailUniversity(name){
  const sidebarTitle = document.querySelector('.uni-card h2');

  if(sidebarTitle) sidebarTitle.textContent = name;
}

function selectUniversity(button){
  document.querySelectorAll('.uni-icon').forEach(el => {
    el.classList.toggle('active', el === button);
  });
  updateRailUniversity(button.dataset.name);
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
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `uni-icon${index === 0 ? ' active' : ''}`;
    button.dataset.name = university.name;
    button.setAttribute('aria-label', university.name);

    const image = document.createElement('img');
    image.src = university.image;
    image.alt = university.name;
    button.appendChild(image);

    button.addEventListener('click', () => selectUniversity(button));
    fragment.appendChild(button);
  });

  rail.insertBefore(fragment, addButton);
  if(universities[0]) updateRailUniversity(universities[0].name);
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
