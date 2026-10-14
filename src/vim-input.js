import { EditorState, Prec } from '@codemirror/state';
import { EditorView, gutter, GutterMarker } from '@codemirror/view';
import { Vim, getCM, vim } from '@replit/codemirror-vim';

// Some browser/input-method combinations deliver text input even after Vim
// consumed keydown. Keep those native edits out of normal and visual modes.
export function vimEditing() {
  let commandKey = false;
  const inCommandMode = view => {
    const state = getCM(view)?.state.vim;
    return state && !state.insertMode;
  };
  return [
    Prec.highest(vim()),
    EditorView.domEventObservers({
      keydown(event, view) {
        commandKey = !!inCommandMode(view) && event.key.length === 1 &&
          !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing;
      },
      compositionstart() {
        commandKey = false;
      },
      blur() {
        commandKey = false;
      },
    }),
    EditorView.domEventHandlers({
      beforeinput(event, view) {
        if (event.target !== view.contentDOM || event.isComposing ||
            !event.cancelable) return false;
        if ((commandKey || inCommandMode(view)) &&
            /^(insert|delete)/.test(event.inputType)) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    }),
    // Let Vim's own input handler process IME commands first. This fallback
    // also protects browsers whose composition events cannot be cancelled.
    Prec.lowest(EditorView.inputHandler.of(view =>
      commandKey || !!inCommandMode(view))),
  ];
}



import { indentUnit, HighlightStyle, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';

// A non-fallback empty highlighter suppresses basicSetup's fallback colors
// while keeping Markdown parsing available for indentation and editing.
const plainHighlightStyle = HighlightStyle.define([]);


export const vimrcExample = `" Nootes supports a practical subset of Vim configuration.
syntax on
set number
set wrap
set tabstop=4 shiftwidth=2 expandtab
let mapleader = ","
inoremap jj <Esc>
nnoremap <Leader>w :w<CR>
`;
const defaults = { syntax: true, number: true, relativenumber: false, wrap: true, tabstop: 4, shiftwidth: 2, expandtab: true, timeoutlen: 200, textwidth: 80, pcre: true };
const aliases = { nu: 'number', rnu: 'relativenumber', ts: 'tabstop', sw: 'shiftwidth', et: 'expandtab', tw: 'textwidth' };
const booleans = new Set(['number', 'relativenumber', 'wrap', 'expandtab', 'pcre']);
const limits = { tabstop: [1, 16], shiftwidth: [1, 16], timeoutlen: [10, 5000], textwidth: [0, 1000] };
const mapContexts = { n: 'normal', i: 'insert', v: 'visual', o: 'operatorPending' };

function normalizeKeys(keys, leader) {
  return keys.replace(/<leader>/gi, () => leader).replace(/<(esc|cr|enter|space|tab|bs|backspace|lt|nop)>/gi, (_, name) =>
    ({ esc: '<Esc>', cr: '<CR>', enter: '<CR>', space: '<Space>', tab: '<Tab>', bs: '<BS>', backspace: '<BS>', lt: '<lt>', nop: '<Nop>' })[name.toLowerCase()]);
}

// Parse only configuration declarations. Never evaluate Vimscript or execute
// shell/source/plugin commands found in a user's config file.
export function parseVimrc(source) {
  const config = { options: { ...defaults }, mappings: [], warnings: [] };
  let leader = '\\';
  source.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, index) => {
    let line = raw.trim().replace(/^:/, '');
    if (!line || line.startsWith('"')) return;
    const warn = message => config.warnings.push({ line: index + 1, message });
    if (/^syntax(?:\s|$)/.test(line)) {
      const command = /^syntax\s+(on|off|enable)\s*(?:".*)?$/.exec(line);
      if (command) config.options.syntax = command[1] !== 'off';
      else warn('Use syntax on, syntax off, or syntax enable.');
      return;
    }
    const letLeader = /^let\s+(?:g:)?mapleader\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*(?:".*)?$/.exec(line);
    if (letLeader) {
      try {
        const literal = letLeader[1];
        leader = literal[0] === '"' ? JSON.parse(literal) : literal.slice(1, -1).replace(/''/g, "'");
        leader = normalizeKeys(leader.replace(/ /g, '<Space>'), '\\');
        if (!leader || /\s/.test(leader)) throw Error();
      } catch { leader = '\\'; warn('Use a nonempty quoted mapleader; write <Space> for a space.'); }
      return;
    }
    // Inline comments follow whitespace and a double quote. A quote may also
    // be a mapping key, so strip these only from set statements.
    if (/^set\s/.test(line)) {
      line = line.replace(/\s+".*$/, '');
      for (const token of line.slice(4).trim().split(/\s+/)) {
        let [name, value, ...extra] = token.split('=');
        let enabled = true;
        if (name.startsWith('no')) { enabled = false; name = name.slice(2); }
        name = aliases[name] || name;
        if (booleans.has(name) && value === undefined) config.options[name] = enabled;
        else if (enabled && limits[name] && extra.length === 0 && /^\d+$/.test(value || '')) {
          const number = Number(value), [min, max] = limits[name];
          if (number >= min && number <= max) config.options[name] = number;
          else warn(`${name} must be between ${min} and ${max}.`);
        } else warn(`Unsupported or invalid option: ${token}`);
      }
      return;
    }
    const mapping = /^(map|nmap|imap|vmap|omap|noremap|nnoremap|inoremap|vnoremap|onoremap)\s+(?:<silent>\s+)?(\S+)\s+(\S+)\s*(?:".*)?$/.exec(line);
    if (mapping) {
      const [, command, lhs, rhs] = mapping;
      if (/^<(?:expr|buffer|script|nowait)>$/i.test(lhs) || lhs.startsWith(':')) {
        warn('Mapping attributes other than <silent> and Ex-command aliases are unsupported.');
        return;
      }
      const context = command === 'noremap' ? undefined : mapContexts[command[0]];
      config.mappings.push({ lhs: normalizeKeys(lhs, leader), rhs: normalizeKeys(rhs, leader), context, recursive: !command.includes('noremap') });
      return;
    }
    warn(`Unsupported command: ${line.split(/\s+/)[0]}`);
  });
  return config;
}

export function applyVimrcMappings(config) {
  // Restore the engine's defaults before replaying this file, so removing a
  // mapping from .vimrc takes effect immediately and does not stack bindings.
  Vim.mapclear();
  for (const mapping of config.mappings) {
    if (mapping.rhs === '<Nop>') Vim.map(mapping.lhs, '', mapping.context);
    else (mapping.recursive ? Vim.map : Vim.noremap)(mapping.lhs, mapping.rhs, mapping.context);
  }
}

// The engine gives built-in single-key commands precedence over custom
// prefixes (for example comma or Space as a leader). Buffer those prefixes
// before its key handler, then dispatch a completed mapping through Vim.
function mappingPrefixes(config) {
  let pending = [];
  const tokens = text => text.match(/<[^>]+>|./gu) || [];
  const mappings = config.mappings.map(mapping => ({...mapping, keys: tokens(mapping.lhs)}));
  return Prec.highest(EditorView.domEventHandlers({
    blur() { pending = []; return false; },
    keydown(event, view) {
      const cm = getCM(view), state = cm?.state.vim;
      if (!state || state.insertMode || state.expectLiteralNext || event.isComposing) {
        pending = [];
        return false;
      }
      const key = Vim.vimKeyFromEvent(event, state);
      if (!key) return false;
      if (key === '<Esc>' && pending.length) { pending = []; return true; }
      const context = state.inputState.operator ? 'operatorPending' : state.visualMode ? 'visual' : 'normal';
      const applicable = mappings.filter(mapping => !mapping.context || mapping.context === context);
      const sequence = [...pending, key];
      const matches = applicable.filter(mapping => sequence.every((part, index) => part === mapping.keys[index]));
      const exact = matches.findLast(mapping => mapping.keys.length === sequence.length);
      if (exact && pending.length) {
        pending = [];
        Vim.handleKey(cm, exact.lhs);
        return true;
      }
      if (matches.some(mapping => mapping.keys.length > sequence.length)) {
        pending = sequence;
        return true;
      }
      if (pending.length) {
        const previous = pending;
        pending = [];
        for (const part of previous) Vim.handleKey(cm, part);
        Vim.handleKey(cm, key);
        return true;
      }
      return false;
    },
  }));
}

class NumberMarker extends GutterMarker {
  constructor(value) { super(); this.value = value; }
  eq(other) { return this.value === other.value; }
  toDOM() { return document.createTextNode(this.value); }
}
export function vimrcExtensions(config) {
  const options = config.options;
  return [
    mappingPrefixes(config),
    syntaxHighlighting(options.syntax ? defaultHighlightStyle : plainHighlightStyle),
    Prec.highest(EditorState.tabSize.of(options.tabstop)),
    Prec.highest(indentUnit.of(options.expandtab ? ' '.repeat(options.shiftwidth) : '\t')),
    options.wrap ? EditorView.lineWrapping : [],
    EditorView.theme({ '.cm-lineNumbers': { display: 'none' } }),
    options.number || options.relativenumber ? gutter({
      class: 'cm-vim-lineNumbers',
      lineMarker(view, line) {
        const number = view.state.doc.lineAt(line.from).number;
        const current = view.state.doc.lineAt(view.state.selection.main.head).number;
        const value = options.relativenumber && (number !== current || !options.number) ? Math.abs(number - current) : number;
        return new NumberMarker(String(value));
      },
      lineMarkerChange: update => update.selectionSet || update.docChanged,
      initialSpacer: view => new NumberMarker(String(view.state.doc.lines)),
      updateSpacer: (spacer, update) => new NumberMarker(String(update.state.doc.lines)),
    }) : [],
  ];
}

export function applyVimrcOptions(view, config) {
  const cm = getCM(view);
  if (!cm) return;
  Vim.setOption('insertModeEscKeysTimeout', config.options.timeoutlen, cm);
  Vim.setOption('textwidth', config.options.textwidth, cm);
  Vim.setOption('pcre', config.options.pcre, cm);
}
