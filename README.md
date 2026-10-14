# Nootes

A quiet, self-hosted Markdown notebook with Vim editing. Python serves the app and writes notes to ordinary `.md` files on your disk. The frontend bundles CodeMirror 6, Vim bindings, and a sanitized Markdown preview; no cloud service or database is required.

## Run locally

Requires Python 3.10+ and Node.js 20.19+ (for building the frontend).

```sh
npm install
npm run build
npm start
```

Open http://127.0.0.1:8080. Create your first note using **New note**. Notes autosave after 650 ms of inactivity. The save indicator reports failures; keep the tab open until it says **All changes saved**.

## Windows startup

`npm start` uses a launcher embedded in `package.json` to detect a working Python 3.10+ installation; no separate `scripts/python.mjs` file is required. On Windows it tries `py -3`, `python`, then `python3`, and rejects commands that only print `Python` without executing a script.

If you prefer to start the backend directly:

```powershell
py -3 server.py
```

If no interpreter is detected, install Python from [python.org](https://www.python.org/downloads/), reopen your terminal, and retry. Windows app execution aliases can point to a placeholder instead of an installed interpreter; see [Python's Windows troubleshooting guide](https://docs.python.org/3/using/windows.html#troubleshooting).

To use a specific interpreter in PowerShell, set its executable path without embedded quotes:

```powershell
$env:PYTHON = 'C:\Program Files\Python312\python.exe'
npm start
```

## Self-host with Docker

```sh
docker compose up --build -d
```

Open http://127.0.0.1:8080. The `./notes` directory is mounted into the container, so Markdown files survive rebuilds. Back up this directory with your usual backup tools.

## Configuration

- `NOTES_DIR`: Markdown folder, defaults to `./notes` beside `server.py`.
- `HOST`: listen address, defaults to `127.0.0.1`.
- `PORT`: listen port, defaults to `8080`.

```sh
NOTES_DIR=/path/to/my/notes PORT=8090 npm start
```

In Windows PowerShell:

```powershell
$env:NOTES_DIR = 'C:\Users\YourName\Documents\Nootes'
$env:PORT = '8090'
npm start
```

The app lists top-level `.md` files in this folder. It reads existing files without importing them into a database. Reload to pick up edits made outside the app. Filename rules allow letters, digits, spaces, underscores, hyphens, and dots, starting with a letter or digit; path traversal and symlinks are rejected. Keep a single active editor per file: concurrent edits use last-write-wins.

The default binding is local-only. For remote hosting, place the app behind an authenticated HTTPS reverse proxy; the app itself has no login. Docker publishes only to localhost by default. Set `HOST=0.0.0.0` for direct LAN access if appropriate.

## Editing

Vim is enabled by default. Click the editor, press `i` to insert, and `Esc` to return to normal mode. Use `h j k l`, `dd`, `u`, `/`, visual selections, and other standard CodeMirror Vim commands. `:w` and Cmd/Ctrl+S save. Cmd/Ctrl+N opens the new-note dialog. Vim can be switched off with the toolbar toggle. Write, split, and preview layouts are available. Download exports the current Markdown text.

## Vim configuration (.vimrc)

The app loads `<NOTES_DIR>/.vimrc` on startup. Open **Settings > Vim configuration** to edit it, **Save & apply** to write it to disk and apply it immediately, or **Reload from disk** after editing the file externally. The same file is shared across browsers and persists in the Docker notes volume. Other open browsers pick up changes when reloaded or with **Reload from disk**.

Start with [vimrc.example](vimrc.example), or use **Use example** in Settings:

```vim
set number relativenumber
set wrap
set tabstop=4 shiftwidth=2 expandtab
let mapleader = ","
inoremap jj <Esc>
nnoremap <Leader>w :w<CR>
```

This maps `jj` in insert mode to Escape and `,w` in normal mode to save. Save an empty configuration to restore defaults. Removing a mapping and saving restores its original binding. Preferences apply without replacing your note, cursor selection, or undo history, and survive switching notes and toggling Vim.

Supported declarations:

- `map`, `noremap`, and their `n`, `i`, `v`, and `o` mode variants. `<silent>` is accepted; special keys such as `<Esc>`, `<CR>`, `<Space>`, and `<C-s>` use Vim notation. Insert-mode mappings follow the browser Vim engine's behavior.
- `let mapleader = ","` (also accepts `g:mapleader` and quoted `<Space>` or a literal space).
- `set number` / `nonumber` (`nu`), `relativenumber` / `norelativenumber` (`rnu`), `wrap` / `nowrap`, and `expandtab` / `noexpandtab` (`et`).
- `set tabstop=N` (`ts`) and `shiftwidth=N` (`sw`), from 1–16; `textwidth=N` (`tw`), from 0–1000, used for Vim formatting; `timeoutlen=N`, from 10–5000 ms, used for insert-mode escape mappings; `pcre` / `nopcre` controls regex syntax in Vim searches.
- Blank lines and comments beginning with `"`. Save the file as UTF-8; Windows line endings and a UTF-8 BOM are accepted.

This is a configuration subset, not a full Vimscript runtime. Unsupported commands, options, mapping attributes, expressions, scripts, and plugins are skipped with line-specific messages in Settings. File edits are never executed as shell commands. Configure color schemes separately under **Settings > Color scheme**.

Restart the Python server after updating to this version so the `.vimrc` API is available.

## Appearance

Open **Settings** using the sliders icon in the top-right toolbar. Choose **Forest**, **Midnight**, or **Paper**. The scheme applies instantly to the workspace, Markdown preview, and editor, and is remembered in this browser using local storage.

## Development and tests

```sh
npm run build
npm test
```

After frontend edits rebuild, then reload the Python-served app.
# nootes
