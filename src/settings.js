const storageKey = 'nootes.colorScheme';
const schemes = [
  { id: 'forest', name: 'Forest', description: 'Soft greens · Dark', colors: ['#171a19', '#1d211f', '#bcd5a5'] },
  { id: 'midnight', name: 'Midnight', description: 'Cool blues · Dark', colors: ['#141922', '#1c2431', '#a9c5ff'] },
  { id: 'paper', name: 'Paper', description: 'Warm neutrals · Light', colors: ['#faf8f3', '#efede5', '#526d3e'] },
];
let current = 'forest';
try {
  const saved = localStorage.getItem(storageKey);
  if (schemes.some(scheme => scheme.id === saved)) current = saved;
} catch { /* Settings still work when browser storage is unavailable. */ }
document.documentElement.dataset.theme = current;

export function setupSettings() {
  const dialog = document.createElement('dialog');
  dialog.id = 'settings-dialog';
  dialog.className = 'settings-dialog';
  dialog.setAttribute('aria-labelledby', 'settings-title');
  dialog.innerHTML = `
    <button type="button" class="close icon-button" aria-label="Close settings"><i data-lucide="x"></i></button>
    <div class="settings-eyebrow"><i data-lucide="sliders-horizontal"></i> MAKE IT YOURS</div>
    <h2 id="settings-title">Settings</h2>
    <p>A space that feels right for you.</p>
    <fieldset class="scheme-fieldset">
      <legend>Color scheme</legend>
      <p>Choose the colors for your workspace and Markdown editor.</p>
      <div class="scheme-options">
        ${schemes.map(scheme => `
          <label class="scheme-option">
            <input type="radio" name="color-scheme" value="${scheme.id}" ${current === scheme.id ? 'checked' : ''}>
            <span class="scheme-card">
              <span class="scheme-preview" style="--sample-bg:${scheme.colors[0]};--sample-sidebar:${scheme.colors[1]};--sample-accent:${scheme.colors[2]}" aria-hidden="true">
                <span class="sample-sidebar"><span></span><span></span><span></span></span>
                <span class="sample-document"><span class="sample-title"></span><span></span><span></span><span></span></span>
              </span>
              <span class="scheme-name">${scheme.name}<i data-lucide="check"></i></span>
              <span class="scheme-description">${scheme.description}</span>
            </span>
          </label>`).join('')}
      </div>
    </fieldset>
    <div class="settings-footer"><span id="settings-status" role="status">Changes apply instantly and are saved in this browser.</span><button type="button" class="primary settings-done">Done</button></div>
  `;
  document.body.append(dialog);
  dialog.querySelector('.close').onclick = () => dialog.close();
  dialog.querySelector('.settings-done').onclick = () => dialog.close();
  dialog.addEventListener('change', event => {
    if (event.target.name !== 'color-scheme') return;
    current = event.target.value;
    document.documentElement.dataset.theme = current;
    try {
      localStorage.setItem(storageKey, current);
      dialog.querySelector('#settings-status').textContent = `${schemes.find(s => s.id === current).name} is saved in this browser.`;
    } catch {
      dialog.querySelector('#settings-status').textContent = 'Applied for this session. Browser storage is unavailable.';
    }
  });
  document.querySelector('#settings').onclick = () => dialog.showModal();
}
