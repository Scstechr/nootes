import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const name of ['window', 'Window', 'document', 'MutationObserver', 'HTMLElement', 'Node', 'KeyboardEvent', 'InputEvent', 'Event'])
  globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
const { EditorView, basicSetup } = await import('codemirror');
const { getCM, Vim } = await import('@replit/codemirror-vim');
const { vimEditing } = await import('../src/vim-input.js');
const { parseVimrc, applyVimrcMappings, applyVimrcOptions, vimrcExtensions } = await import('../src/vimrc.js');
const { indentUnit } = await import('@codemirror/language');

function editor(config = null) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const view = new EditorView({ doc: 'alpha\nbeta\ngamma', extensions: [...(config ? [vimrcExtensions(config)] : []), vimEditing(), basicSetup], parent });
  view.focus();
  if (config) applyVimrcOptions(view, config);
  return view;
}
function key(view, value) {
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
}
function textInput(view, data, inputType = 'insertText') {
  const event = new InputEvent('beforeinput', { data, inputType, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

test('normal/visual commands move and select while duplicate native input is blocked', () => {
  const view = editor();
  try {
    key(view, 'l');
    assert.equal(view.state.selection.main.head, 1);
    assert.equal(textInput(view, 'l'), true);
    key(view, 'v');
    key(view, 'l');
    assert.equal(getCM(view).state.vim.visualMode, true);
    assert.equal(view.state.selection.main.empty, false);
    assert.equal(textInput(view, 'l'), true);
    assert.equal(view.state.doc.toString(), 'alpha\nbeta\ngamma');
    key(view, 'Escape');
    assert.equal(getCM(view).state.vim.visualMode, false);
  } finally { view.destroy(); }
});

test('insert transition does not insert i; subsequent typing and IME remain available', () => {
  const view = editor();
  try {
    key(view, 'i');
    assert.equal(getCM(view).state.vim.insertMode, true);
    assert.equal(textInput(view, 'i'), true);
    key(view, 'x');
    assert.equal(textInput(view, 'x'), false);
    key(view, 'Escape');
    assert.equal(getCM(view).state.vim.insertMode, false);
    assert.equal(textInput(view, 'x'), true);
    key(view, 'i');
    view.contentDOM.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    assert.equal(textInput(view, '日本語', 'insertCompositionText'), false);
    view.contentDOM.dispatchEvent(new Event('compositionend', { bubbles: true }));
  } finally { view.destroy(); }
});

test('Vim operators can still change the document', () => {
  const view = editor();
  try {
    key(view, 'd'); key(view, 'd');
    assert.equal(view.state.doc.toString(), 'beta\ngamma');
    key(view, 'u');
    assert.equal(view.state.doc.toString(), 'alpha\nbeta\ngamma');
  } finally { view.destroy(); }
});


test('vimrc normal mappings and leader save work through the real Vim engine', () => {
  const config = parseVimrc('let mapleader = ","\nnnoremap h l\nnnoremap <Leader>w :w<CR>');
  applyVimrcMappings(config);
  const view = editor(config);
  let saves = 0;
  Vim.defineEx('write', 'w', () => { saves++; });
  try {
    key(view, 'h');
    assert.equal(view.state.selection.main.head, 1);
    assert.equal(view.state.doc.toString(), 'alpha\nbeta\ngamma');
    key(view, ','); key(view, 'w');
    assert.equal(saves, 1);
  } finally { view.destroy(); applyVimrcMappings(parseVimrc('')); }
});

test('vimrc insert-mode jj mapping exits without inserting its keys', () => {
  const config = parseVimrc('inoremap jj <Esc>');
  applyVimrcMappings(config);
  const view = editor(config);
  try {
    key(view, 'i'); key(view, 'j'); key(view, 'j');
    assert.equal(getCM(view).state.vim.insertMode, false);
    assert.equal(view.state.doc.toString(), 'alpha\nbeta\ngamma');
  } finally { view.destroy(); applyVimrcMappings(parseVimrc('')); }
});

test('vimrc tabstop and shiftwidth configure actual indentation; removing mappings restores defaults', () => {
  const config = parseVimrc('set ts=8 sw=3 et nowrap nonumber\nnnoremap h l');
  applyVimrcMappings(config);
  const view = editor(config);
  try {
    assert.equal(view.state.tabSize, 8);
    assert.equal(view.state.facet(indentUnit), '   ');
    key(view, '>'); key(view, '>');
    assert.equal(view.state.doc.toString(), '   alpha\nbeta\ngamma');
    key(view, 'u');
    key(view, 'h');
    assert.equal(view.state.selection.main.head, 1);
    applyVimrcMappings(parseVimrc(''));
    key(view, 'h');
    assert.equal(view.state.selection.main.head, 0);
  } finally { view.destroy(); applyVimrcMappings(parseVimrc('')); }
});
