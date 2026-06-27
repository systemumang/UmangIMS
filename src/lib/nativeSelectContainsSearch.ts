let installed = false;
let typed = '';
let lastAt = 0;

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

export function installNativeSelectContainsSearch() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

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
