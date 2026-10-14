# Nootes

A self-hosted Markdown notebook with Vim editing and a dependency-free Node.js backend. Notes are ordinary `.md` files on your disk. The frontend bundles CodeMirror 6, Vim bindings, and a sanitized Markdown preview; no cloud service or database is required.

## Run locally (Windows, macOS, Linux)

Requires Node.js 20.19+ or 22+.

```sh
npm install
npm run build
npm start
```

Open the URL printed by the server (normally http://127.0.0.1:8080). If the default port is occupied, startup tries the next ports, up to 8089. An explicitly configured `PORT` stays fixed. Create your first note using **New note**. Notes autosave after 650 ms of inactivity. Keep the tab open until the save indicator says **All changes saved**.

The backend entry point is `server.mjs`; you can also run `node server.mjs` directly. Python and a separate launcher script are no longer needed. Stop the previous server before starting the Node backend. Existing Markdown files and `.vimrc` work in the same notes folder.

## Self-host with Docker

```sh
docker compose up --build -d
```

The image uses Node.js for both the frontend build and backend. Open http://127.0.0.1:8080. The `./notes` directory is mounted into the container, so Markdown files and `.vimrc` survive rebuilds. Back up this directory with your usual backup tools.

## Configuration

- `NOTES_DIR`: Markdown folder, defaults to `./notes` beside `server.mjs`.
- `HOST`: listen address, defaults to `127.0.0.1`.
- `PORT`: listen port, defaults to `8080`.

On macOS/Linux:

```sh
NOTES_DIR=/path/to/my/notes PORT=8090 npm start
```

In Windows PowerShell:

```powershell
$env:NOTES_DIR = 'C:\Users\YourName\Documents\Nootes'
$env:PORT = '8090'
npm start
```

The app lists top-level `.md` files in this folder. Reload to pick up edits made outside the app. Filenames allow letters, digits, spaces, underscores, hyphens, and dots, starting with a letter or digit; path traversal, Windows device names, and symlinks are rejected. Keep a single active editor per file: concurrent edits use last-write-wins. Writes are serialized and atomically replace files.

The default binding is local-only. For remote hosting, place the app behind an authenticated HTTPS reverse proxy; the app itself has no login. Docker publishes only to localhost by default. Set `HOST=0.0.0.0` for direct LAN access if appropriate.

## Editing

Vim is enabled by default. Click the editor, press `i` to insert, and `Esc` to return to normal mode. Use `h j k l`, `dd`, `u`, `/`, visual selections, and other standard CodeMirror Vim commands. `:w` and Cmd/Ctrl+S save. Cmd/Ctrl+N opens the new-note dialog. Vim can be switched off with the toolbar toggle. Write, split, and preview layouts are available. Download exports the current Markdown text.

## Vim configuration (.vimrc)

The app loads `<NOTES_DIR>/.vimrc` when opened. Use **Settings > Vim configuration** to edit it, **Save & apply** to write it to disk and apply it immediately, or **Reload from disk** after editing externally. This file is shared across browsers and persists in the Docker notes volume. Other open browsers pick up changes when reloaded or with **Reload from disk**.

Use **Use example** in Settings, or save this as `.vimrc` in your notes folder:

```vim
syntax on
set number relativenumber
set wrap
set tabstop=4 shiftwidth=2 expandtab
let mapleader = ","
inoremap jj <Esc>
nnoremap <Leader>w :w<CR>
```

This maps `jj` in insert mode to Escape and `,w` in normal mode to save. Save an empty configuration to restore defaults. Removing a mapping and saving restores its original binding. Applying preferences preserves the open note, selection, and undo history.

Supported declarations:

- `syntax on` enables Markdown syntax highlighting (the default). `syntax off` disables highlighting while preserving Markdown editing. `syntax enable` restores highlighting. Changes apply immediately with **Save & apply**.

- `map`, `noremap`, and their `n`, `i`, `v`, and `o` mode variants. `<silent>` is accepted. Special keys use Vim notation, such as `<Esc>`, `<CR>`, `<Space>`, and `<C-s>`.
- `let mapleader = ","` (also accepts `g:mapleader`, quoted `<Space>`, or a literal space).
- `set number` / `nonumber` (`nu`), `relativenumber` / `norelativenumber` (`rnu`), `wrap` / `nowrap`, and `expandtab` / `noexpandtab` (`et`).
- `set tabstop=N` (`ts`) and `shiftwidth=N` (`sw`), from 1–16; `textwidth=N` (`tw`), from 0–1000, used for Vim formatting; `timeoutlen=N`, from 10–5000 ms, used for insert-mode escape mappings; `pcre` / `nopcre` for Vim search regex syntax.
- Blank lines and comments beginning with `"`. UTF-8, Windows line endings, and a UTF-8 BOM are accepted.

Unsupported Vimscript commands, options, expressions, scripts, and plugins are skipped with line-specific messages in Settings. Configuration is never executed as shell commands. The parser is included in `src/vim-input.js`, so no separate `src/vimrc.js` file is required.

## Appearance

Open **Settings** using the sliders icon in the top-right toolbar. Choose **Forest**, **Midnight**, or **Paper**. The scheme applies instantly to the workspace, preview, and editor, and is remembered in this browser.

## Development and tests

```sh
npm test
npm run build
```

Tests use Node's test runner for both the backend and editor. Backend tests cover Markdown and `.vimrc` persistence, restarts, duplicate creation, request validation, and static files.

For frontend development, run `npm start` in one terminal and `npm run dev` in another. Vite proxies `/api` to the backend at port 8080. Rebuild after frontend edits to update the app served directly by the backend.

## Port already in use

When `PORT` is unset, `npm start` automatically skips occupied ports and prints the actual URL. If you explicitly set an occupied port, choose another value.

Windows PowerShell:

```powershell
$env:PORT = '8090'
npm start
```

Windows Command Prompt:

```bat
set PORT=8090
npm start
```

For Vite development when the backend uses a port other than 8080, set `BACKEND_URL` to its printed URL before `npm run dev`:

```powershell
$env:BACKEND_URL = 'http://127.0.0.1:8090'
npm run dev
```
