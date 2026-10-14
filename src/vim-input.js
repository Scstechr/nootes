import { Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getCM, vim } from '@replit/codemirror-vim';

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
