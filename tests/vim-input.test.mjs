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
const { parseVimrc, vimrcExample, applyVimrcMappings, applyVimrcOptions, vimrcExtensions } = await import('../src/vim-input.js');
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

test('parses Windows line endings, BOM, comments, aliases and booleans', () => {
  const config = parseVimrc('\uFEFF" comment\r\nset nu rnu nowrap ts=8 sw=3 noet " inline comment\r\nset timeoutlen=400 tw=72 nopcre');
  assert.deepEqual(config.warnings, []);
  assert.deepEqual(config.options, { syntax: true, number: true, relativenumber: true, wrap: false, tabstop: 8, shiftwidth: 3, expandtab: false, timeoutlen: 400, textwidth: 72, pcre: false });
});

test('expands leaders, preserves mode scopes, and supports nonrecursive mappings', () => {
  const config = parseVimrc('let mapleader = "<Space>"\nnnoremap <leader>w :w<cr>\ninoremap jj <esc>\nvmap <silent> H ^\nomap Q w\nnoremap X x');
  assert.deepEqual(config.warnings, []);
  assert.equal(config.mappings[0].lhs, '<Space>w');
  assert.equal(config.mappings[0].rhs, ':w<CR>');
  assert.equal(config.mappings[1].context, 'insert');
  assert.equal(config.mappings[1].recursive, false);
  assert.equal(config.mappings[2].context, 'visual');
  assert.equal(config.mappings[2].recursive, true);
  assert.equal(config.mappings[3].context, 'operatorPending');
  assert.equal(config.mappings[4].context, undefined);
});

test('unsupported Vimscript and invalid option values produce precise warnings', () => {
  const config = parseVimrc('source ~/.vimrc\nset ts=0 sw=500\ncall system("no")\nset number ignorecase');
  assert.equal(config.options.tabstop, 4);
  assert.equal(config.options.shiftwidth, 2);
  assert.equal(config.options.number, true);
  assert.deepEqual(config.warnings.map(warning => warning.line), [1, 2, 2, 3, 4]);
  assert.equal(config.mappings.length, 0);
});

test('example is valid and empty configuration restores defaults', () => {
  assert.deepEqual(parseVimrc(vimrcExample).warnings, []);
  assert.equal(parseVimrc('').mappings.length, 0);
  assert.equal(parseVimrc('').options.wrap, true);
});


test('literal Space leaders and dollar sequences expand literally', () => {
  const space = parseVimrc('let mapleader = " "\nnnoremap <Leader>w :w<CR>');
  assert.deepEqual(space.warnings, []);
  assert.equal(space.mappings[0].lhs, '<Space>w');
  const dollar = parseVimrc('let mapleader = "$&"\nnnoremap <Leader>w :w<CR>');
  assert.equal(dollar.mappings[0].lhs, '$&w');
});


test('syntax commands support on, off, enable and inline comments', () => {
  assert.equal(parseVimrc('').options.syntax, true);
  const off = parseVimrc('syntax off " plain text colors');
  assert.deepEqual(off.warnings, []);
  assert.equal(off.options.syntax, false);
  assert.equal(parseVimrc('syntax off\nsyntax on').options.syntax, true);
  assert.equal(parseVimrc('syntax off\n:syntax enable').options.syntax, true);
  const invalid = parseVimrc('syntax maybe');
  assert.equal(invalid.options.syntax, true);
  assert.deepEqual(invalid.warnings, [{line: 1, message: 'Use syntax on, syntax off, or syntax enable.'}]);
});

test('syntax off removes Markdown highlight spans and on restores them without changing text or selection', async () => {
  const { markdown } = await import('@codemirror/lang-markdown');
  const { Compartment } = await import('@codemirror/state');
  const preferences = new Compartment();
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = '# Heading\n\n**Bold** and `code`';
  const view = new EditorView({doc, extensions: [preferences.of(vimrcExtensions(parseVimrc('syntax on'))), basicSetup, markdown()], parent});
  const coloredSpans = () => [...view.contentDOM.querySelectorAll('span')].filter(span => /(?:^| )ͼ/.test(span.className)).length;
  try {
    assert.ok(coloredSpans() > 0, 'Markdown is highlighted initially');
    view.dispatch({selection: {anchor: 4, head: 8}});
    view.dispatch({effects: preferences.reconfigure(vimrcExtensions(parseVimrc('syntax off')))});
    assert.equal(coloredSpans(), 0, 'Fallback syntax colors are disabled');
    assert.equal(view.state.doc.toString(), doc);
    assert.equal(view.state.selection.main.anchor, 4);
    assert.equal(view.state.selection.main.head, 8);
    view.dispatch({effects: preferences.reconfigure(vimrcExtensions(parseVimrc('syntax on')))});
    assert.ok(coloredSpans() > 0, 'Markdown highlighting is restored');
    assert.equal(view.state.doc.toString(), doc);
    assert.equal(view.state.selection.main.anchor, 4);
    assert.equal(view.state.selection.main.head, 8);
  } finally { view.destroy(); parent.remove(); }
});
