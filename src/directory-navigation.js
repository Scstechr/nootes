// Keep navigation scoped to a focused directory so editor commands stay independent.
export function directoryNavigation(pane, { enabled, open }) {
  let count = '', pendingG = false;
  pane.addEventListener('keydown', event => {
    if (!enabled() || event.metaKey || event.altKey || (event.ctrlKey && !['d', 'u'].includes(event.key))) return;
    // A held Enter from :q can repeat after focus moves into the directory.
    // Opening a note requires a fresh press, while movement may still repeat.
    if (event.repeat && ['l', 'Enter', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      return;
    }
    const items = [...pane.querySelectorAll('[data-name]')];
    if (!items.length) return;
    const index = Math.max(0, items.indexOf(document.activeElement));
    const focus = next => {
      const item = items[Math.max(0, Math.min(items.length - 1, next))];
      item.focus();
      item.scrollIntoView?.({block: 'nearest'});
    };
    if (/^[0-9]$/.test(event.key) && (count || event.key !== '0')) {
      count = (count + event.key).slice(0, 6);
      event.preventDefault();
      return;
    }
    const steps = Number(count) || 1;
    let handled = true;
    if (event.ctrlKey) focus(index + (event.key === 'd' ? 1 : -1) * Math.max(1, Math.floor(items.length / 2)) * steps);
    else if (event.key === 'j' || event.key === 'ArrowDown') focus(index + steps);
    else if (event.key === 'k' || event.key === 'ArrowUp') focus(index - steps);
    else if (event.key === 'G') focus(count ? steps - 1 : items.length - 1);
    else if (event.key === 'g') {
      if (pendingG) focus(count ? steps - 1 : 0);
      else { pendingG = true; event.preventDefault(); return; }
    }
    else if (['l', 'Enter', 'ArrowRight'].includes(event.key)) open(items[index].dataset.name);
    else if (event.key === 'h' || event.key === 'ArrowLeft') pane.focus();
    else handled = false;
    count = '';
    pendingG = false;
    if (handled) event.preventDefault();
  });
  pane.addEventListener('focusout', event => {
    if (!pane.contains(event.relatedTarget)) { count = ''; pendingG = false; }
  });
}
