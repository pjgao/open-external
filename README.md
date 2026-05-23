# Open in Typora

A VSCode extension that lets you open Markdown files in [Typora](https://typora.io) directly from the editor.

## Features

- **Command Palette**: Press `Ctrl+Shift+P` and run **"Open in Typora"** to open the current `.md` file in Typora.
- **Editor Title Button**: A quick-access button appears in the top-right corner of the editor when a Markdown file is open.
- **Auto-detect Typora**: Automatically finds the Typora executable on Windows, macOS, and Linux (including WSL).
- **WSL Support**: Works seamlessly when VSCode is connected to WSL — converts paths and launches Windows Typora via `cmd.exe`.

## Usage

1. Open a `.md` file in VSCode.
2. Either:
   - Click the **edit icon** in the editor title bar, **or**
   - Press `Ctrl+Shift+P` → type **"Open in Typora"** → press Enter.
3. The file opens in Typora.

## Configuration

If Typora is not found automatically, set the executable path manually:

| Setting | Description | Default |
|---------|-------------|---------|
| `openInTypora.executablePath` | Absolute path to the Typora executable | `""` (auto-detect) |

### Auto-detect paths

| Platform | Search locations |
|----------|-----------------|
| Windows | `%LOCALAPPDATA%\Programs\Typora\Typora.exe`, `%ProgramFiles%\Typora\Typora.exe` |
| macOS | `/Applications/Typora.app/Contents/MacOS/Typora` |
| Linux | `/usr/bin/typora`, `/usr/local/bin/typora`, `/snap/bin/typora` |
| WSL | `/mnt/c/Users/<user>/AppData/Local/Programs/Typora/Typora.exe`, `/mnt/c/Program Files/Typora/Typora.exe` |

## Limitations

- Remote containers and SSH sessions are **not supported** (Typora is a local GUI application).
- WSL is fully supported.

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch for changes
npm run watch

# Package as VSIX
npx vsce package
```

Press `F5` in VSCode to launch the Extension Development Host for testing.

## License

MIT
