import { parseVimrc, vimrcExample } from './vimrc.js';

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

export function setupSettings({ configureVimrc }) {
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
    <section class="vimrc-settings" aria-labelledby="vimrc-heading">
      <div class="vimrc-heading-row"><h3 id="vimrc-heading">Vim configuration</h3><span class="vimrc-badge">.vimrc</span></div>
      <p>Your keybindings, your rhythm. Saved in the notes folder and shared across browsers.</p>
      <label class="vimrc-label" for="vimrc-content">Configuration</label>
      <textarea id="vimrc-content" spellcheck="false" aria-describedby="vimrc-support" placeholder='" Add your Vim preferences here' disabled></textarea>
      <p id="vimrc-support">Supports map/noremap with n, i, v, and o modes, mapleader, and set options: number, relativenumber, wrap, tabstop, shiftwidth, expandtab, timeoutlen, textwidth, pcre. Vimscript and plugins are unsupported.</p>
      <ul id="vimrc-warnings" class="vimrc-warnings" hidden></ul>
      <div class="vimrc-actions"><button type="button" class="vimrc-reload">Reload from disk</button><button type="button" class="vimrc-example">Use example</button><button type="button" class="primary vimrc-save" disabled>Save &amp; apply</button></div>
      <p id="vimrc-status" role="status">Loading local configuration…</p>
      <p id="vimrc-path" class="vimrc-path"></p>
    </section>
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
  const textarea = dialog.querySelector('#vimrc-content');
  const saveButton = dialog.querySelector('.vimrc-save');
  const reloadButton = dialog.querySelector('.vimrc-reload');
  const exampleButton = dialog.querySelector('.vimrc-example');
  const status = dialog.querySelector('#vimrc-status');
  let loaded = false;

  function showWarnings(content) {
    const list = dialog.querySelector('#vimrc-warnings');
    const warnings = parseVimrc(content).warnings;
    list.replaceChildren();
    for (const warning of warnings) {
      const item = document.createElement('li');
      item.textContent = `Line ${warning.line}: ${warning.message}`;
      list.append(item);
    }
    list.hidden = warnings.length === 0;
    return warnings;
  }
  function busy(value) {
    saveButton.disabled = value || !loaded;
    reloadButton.disabled = value;
    exampleButton.disabled = value || !loaded;
    textarea.disabled = value || !loaded;
  }
  async function request(options) {
    const response = await fetch('/api/vimrc', options);
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Could not access .vimrc');
    return data;
  }
  async function reload() {
    busy(true);
    status.classList.remove('error');
    status.textContent = 'Loading local configuration…';
    try {
      const data = await request();
      textarea.value = data.content;
      dialog.querySelector('#vimrc-path').textContent = data.path;
      const warnings = showWarnings(data.content);
      configureVimrc(data.content);
      loaded = true;
      status.textContent = warnings.length ? 'Loaded. Unsupported lines were skipped; see messages above.' : 'Loaded from disk. Supported preferences are active.';
    } catch (error) {
      status.textContent = `Could not load .vimrc: ${error.message}. Restart the updated Python server and reload.`;
      status.classList.add('error');
    } finally { busy(false); }
  }
  textarea.addEventListener('input', () => {
    showWarnings(textarea.value);
    status.classList.remove('error');
    status.textContent = 'Unsaved configuration. Save & apply to update your editors.';
  });
  exampleButton.onclick = () => {
    textarea.value = vimrcExample;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  };
  reloadButton.onclick = reload;
  saveButton.onclick = async () => {
    busy(true);
    status.classList.remove('error');
    status.textContent = 'Saving .vimrc…';
    const content = textarea.value;
    try {
      await request({method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content})});
      const warnings = configureVimrc(content);
      showWarnings(content);
      status.textContent = warnings.length ? 'Saved and applied supported preferences. Unsupported lines were skipped.' : 'Saved to disk. Your Vim preferences are active.';
    } catch (error) {
      status.textContent = `Save failed: ${error.message}`;
      status.classList.add('error');
    } finally { busy(false); }
  };
  document.querySelector('#settings').onclick = () => dialog.showModal();
  reload();
}
