let installed = false;
let typed = '';
let lastAt = 0;

type ActiveMenu = {
  select: HTMLSelectElement;
  root: HTMLDivElement;
  input: HTMLInputElement;
  list: HTMLDivElement;
  cleanup: () => void;
};

let activeMenu: ActiveMenu | null = null;

function isEditableElement(el: EventTarget | null) {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || node.isContentEditable;
}

function findMatchingOption(select: HTMLSelectElement, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  const options = Array.from(select.options);
  return (
    options.find((opt) => opt.text.trim().toLowerCase().includes(needle) && !opt.disabled) ??
    options.find((opt) => String(opt.value ?? '').trim().toLowerCase().includes(needle) && !opt.disabled) ??
    null
  );
}

function canEnhanceSelect(select: HTMLSelectElement) {
  return !select.disabled && !select.multiple && select.size <= 1;
}

function getSelectScale(select: HTMLSelectElement) {
  const rect = select.getBoundingClientRect();
  const htmlZoom = Number.parseFloat(window.getComputedStyle(document.documentElement).zoom || '1');
  const scaleFromZoom = Number.isFinite(htmlZoom) && htmlZoom > 0 && Math.abs(htmlZoom - 1) > 1e-3 ? htmlZoom : NaN;
  const scaleFromRect = select.offsetWidth ? rect.width / select.offsetWidth : NaN;
  return (Number.isFinite(scaleFromZoom) ? scaleFromZoom : Number.isFinite(scaleFromRect) && scaleFromRect > 0 ? scaleFromRect : 1) || 1;
}

function positionMenu(menu: ActiveMenu) {
  const { select, root } = menu;
  const rect = select.getBoundingClientRect();
  const scale = getSelectScale(select);
  const viewportW = window.innerWidth / scale;
  const viewportH = window.innerHeight / scale;
  const viewportPad = 8;
  const gap = 4;

  const left = Math.max(rect.left / scale + window.scrollX, window.scrollX + viewportPad);
  const width = Math.max(180, Math.min(rect.width / scale, window.scrollX + viewportW - viewportPad - left));
  const top = rect.bottom / scale + window.scrollY + gap;
  const maxHeight = Math.max(180, Math.min(360, window.scrollY + viewportH - viewportPad - top));

  root.style.left = `${Math.round(left)}px`;
  root.style.top = `${Math.round(top)}px`;
  root.style.width = `${Math.round(width)}px`;
  root.style.maxHeight = `${Math.round(maxHeight)}px`;
}

function optionText(option: HTMLOptionElement) {
  return String(option.textContent ?? option.label ?? option.value ?? '').trim();
}

function selectOption(select: HTMLSelectElement, option: HTMLOptionElement) {
  select.value = option.value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  select.focus();
}

function renderOptions(menu: ActiveMenu, query: string) {
  const { select, list } = menu;
  const needle = query.trim().toLowerCase();
  const options = Array.from(select.options).filter((opt) => {
    if (opt.disabled) return false;
    if (!needle) return true;
    return optionText(opt).toLowerCase().includes(needle) || String(opt.value ?? '').toLowerCase().includes(needle);
  });

  list.replaceChildren();

  for (const option of options.slice(0, 200)) {
    const row = document.createElement('button');
    row.type = 'button';
    row.textContent = optionText(option);
    row.title = optionText(option);
    row.style.cssText = [
      'display:block',
      'width:100%',
      'border:0',
      'background:transparent',
      'color:#111827',
      'text-align:left',
      'padding:8px 10px',
      'font:inherit',
      'font-size:13px',
      'line-height:1.25',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis',
      'cursor:pointer',
    ].join(';');
    if (option.selected || option.value === select.value) row.style.background = '#dbeafe';
    row.addEventListener('mouseenter', () => {
      row.style.background = option.value === select.value ? '#bfdbfe' : '#f3f4f6';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = option.value === select.value ? '#dbeafe' : 'transparent';
    });
    row.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    row.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectOption(select, option);
      closeSearchableMenu();
    });
    list.appendChild(row);
  }

  if (!options.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No matches';
    empty.style.cssText = 'padding:8px 10px;color:#6b7280;font-size:13px;';
    list.appendChild(empty);
  }
}

function closeSearchableMenu() {
  if (!activeMenu) return;
  activeMenu.cleanup();
  activeMenu.root.remove();
  activeMenu = null;
}

function openSearchableMenu(select: HTMLSelectElement) {
  if (!canEnhanceSelect(select)) return;
  if (activeMenu?.select === select) {
    closeSearchableMenu();
    return;
  }
  closeSearchableMenu();

  const root = document.createElement('div');
  root.style.cssText = [
    'position:absolute',
    'z-index:20000',
    'display:flex',
    'flex-direction:column',
    'box-sizing:border-box',
    'overflow:hidden',
    'border:1px solid #111827',
    'border-radius:6px',
    'background:#fff',
    'box-shadow:0 12px 24px rgba(15,23,42,.18)',
    'font-family:inherit',
  ].join(';');

  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'padding:6px;border-bottom:1px solid #d1d5db;background:#fff;';

  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Search...';
  input.autocomplete = 'off';
  input.style.cssText = [
    'box-sizing:border-box',
    'width:100%',
    'height:30px',
    'border:1px solid #111827',
    'border-radius:4px',
    'padding:4px 8px',
    'font:inherit',
    'font-size:13px',
    'outline:none',
  ].join(';');

  const list = document.createElement('div');
  list.style.cssText = 'overflow:auto;min-height:40px;background:#fff;';
  searchWrap.appendChild(input);
  root.appendChild(searchWrap);
  root.appendChild(list);
  document.body.appendChild(root);

  const onDocMouseDown = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (!target) return;
    if (root.contains(target) || target === select) return;
    closeSearchableMenu();
  };
  const onResizeOrScroll = () => activeMenu && positionMenu(activeMenu);
  const onSelectKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeSearchableMenu();
  };
  const cleanup = () => {
    document.removeEventListener('mousedown', onDocMouseDown, true);
    window.removeEventListener('resize', onResizeOrScroll);
    window.removeEventListener('scroll', onResizeOrScroll, true);
    select.removeEventListener('keydown', onSelectKeyDown);
  };

  activeMenu = { select, root, input, list, cleanup };
  positionMenu(activeMenu);
  renderOptions(activeMenu, '');

  document.addEventListener('mousedown', onDocMouseDown, true);
  window.addEventListener('resize', onResizeOrScroll);
  window.addEventListener('scroll', onResizeOrScroll, true);
  select.addEventListener('keydown', onSelectKeyDown);

  input.addEventListener('input', () => {
    if (!activeMenu) return;
    renderOptions(activeMenu, input.value);
  });
  input.addEventListener('keydown', (event) => {
    if (!activeMenu) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearchableMenu();
      select.focus();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = Array.from(select.options).find((opt) => {
      if (opt.disabled) return false;
      const needle = input.value.trim().toLowerCase();
      return !needle || optionText(opt).toLowerCase().includes(needle) || String(opt.value ?? '').toLowerCase().includes(needle);
    });
    if (first) {
      selectOption(select, first);
      closeSearchableMenu();
    }
  });

  window.setTimeout(() => input.focus(), 0);
}

export function installNativeSelectContainsSearch() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener(
    'mousedown',
    (event) => {
      const select = event.target instanceof HTMLSelectElement ? event.target : null;
      if (!select || !canEnhanceSelect(select)) return;
      event.preventDefault();
      event.stopPropagation();
      openSearchableMenu(select);
    },
    true
  );

  document.addEventListener(
    'keydown',
    (event) => {
      const select = event.target instanceof HTMLSelectElement ? event.target : null;
      if (!select || select.disabled || isEditableElement(event.target)) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key.length !== 1) return;

      const now = Date.now();
      typed = now - lastAt > 900 ? event.key : `${typed}${event.key}`;
      lastAt = now;

      const match = findMatchingOption(select, typed);
      if (!match) return;

      event.preventDefault();
      select.value = match.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    true
  );
}
