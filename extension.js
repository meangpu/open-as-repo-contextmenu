const vscode = require("vscode");
const path = require("path");

// Turns a git remote URL (ssh or https) into { owner, repo }, or undefined if it is not GitHub.
function parseGitHubRemote(remoteUrl) {
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?\/?$/);
  return match ? { owner: match[1], repo: match[2] } : undefined;
}

async function openOnGitHub(uriFromArg) {
  // Explorer passes the clicked item; the editor title/context and palette use the active editor.
  const uri = uriFromArg || vscode.window.activeTextEditor?.document.uri;
  if (!uri || uri.scheme !== "file") {
    vscode.window.showErrorMessage("Select a file or open one in the editor first.");
    return;
  }

  const gitExt = vscode.extensions.getExtension("vscode.git");
  if (!gitExt) {
    vscode.window.showErrorMessage("Built-in Git extension is not available.");
    return;
  }
  const gitExports = gitExt.isActive ? gitExt.exports : await gitExt.activate();
  const api = gitExports.getAPI(1);

  const repo = api.getRepository(uri);
  if (!repo) {
    vscode.window.showWarningMessage(`No git repository found for: ${uri.fsPath}`);
    return;
  }

  const origin = repo.state.remotes.find((r) => r.name === "origin") ?? repo.state.remotes[0];
  const remote = origin && parseGitHubRemote(origin.fetchUrl ?? "");
  if (!remote) {
    vscode.window.showErrorMessage("The repository's remote is not a GitHub URL.");
    return;
  }

  // Branch name when on a branch; commit hash when HEAD is detached.
  const ref = repo.state.HEAD?.name ?? repo.state.HEAD?.commit;
  if (!ref) {
    vscode.window.showErrorMessage("Could not read the current branch or commit.");
    return;
  }

  const stat = await vscode.workspace.fs.stat(uri);
  const kind = stat.type === vscode.FileType.Directory ? "tree" : "blob";
  const relPath = path
    .relative(repo.rootUri.fsPath, uri.fsPath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join("/");

  const url = `https://github.com/${remote.owner}/${remote.repo}/${kind}/${ref}/${relPath}`;
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

// Changed entries in every open repo that are folders (submodules).
// One: use it. Several: ask. None: undefined.
async function pickChangedSubmodule() {
  const gitExt = vscode.extensions.getExtension("vscode.git");
  if (!gitExt) {
    return undefined;
  }
  const gitExports = gitExt.isActive ? gitExt.exports : await gitExt.activate();
  const api = gitExports.getAPI(1);

  const seen = new Set();
  const folders = [];
  for (const repo of api.repositories) {
    for (const change of [...repo.state.indexChanges, ...repo.state.workingTreeChanges]) {
      const uri = change.uri;
      if (seen.has(uri.fsPath)) continue;
      seen.add(uri.fsPath);
      const stat = await vscode.workspace.fs.stat(uri).then((s) => s, () => undefined);
      if (stat && stat.type & vscode.FileType.Directory) {
        folders.push(uri);
      }
    }
  }

  if (folders.length <= 1) {
    return folders[0];
  }
  const picked = await vscode.window.showQuickPick(
    folders.map((uri) => ({ label: path.basename(uri.fsPath), description: uri.fsPath, uri })),
    { placeHolder: "Changed submodule to open as a Git repository" },
  );
  return picked?.uri;
}

async function resolveTargetUri(uriFromContextMenu) {
  // Source Control list passes a resource state (e.g. a changed submodule), not a URI.
  if (uriFromContextMenu?.resourceUri) {
    return uriFromContextMenu.resourceUri;
  }
  // Keybinding in Source Control: VS Code passes no selection to keybindings
  // there, so offer the changed submodules instead.
  if (uriFromContextMenu?.fromScm) {
    return pickChangedSubmodule();
  }
  // Context menu invocation already gives us a URI — use it directly.
  if (uriFromContextMenu) {
    return uriFromContextMenu;
  }

  // Keybinding invocation: no URI is passed, so borrow copyFilePath
  // to read the Explorer's current selection via the clipboard.
  const previousClipboard = await vscode.env.clipboard.readText();
  try {
    await vscode.commands.executeCommand("copyFilePath");
    const pathText = await vscode.env.clipboard.readText();

    if (!pathText) {
      return undefined;
    }
    // Multi-select copies multiple paths separated by newlines — use the first.
    const firstPath = pathText.split(/\r?\n/)[0].trim();
    return firstPath ? vscode.Uri.file(firstPath) : undefined;
  } finally {
    // Put the clipboard back the way it was.
    await vscode.env.clipboard.writeText(previousClipboard);
  }
}

function activate(context) {
  const cmd = vscode.commands.registerCommand(
    "openAsGitRepo.run",
    async (uriFromContextMenu) => {
      const uri = await resolveTargetUri(uriFromContextMenu);

      if (!uri) {
        vscode.window.showErrorMessage(
          "No file or folder is selected in the Explorer.",
        );
        return;
      }

      // A plain file (e.g. a changed file in Source Control) is not a repo root;
      // without this the parent repo would be reported as "opened".
      const stat = await vscode.workspace.fs.stat(uri).then(
        (s) => s,
        () => undefined,
      );
      // Bitwise: a symlinked folder is Directory | SymbolicLink.
      if (!stat || !(stat.type & vscode.FileType.Directory)) {
        vscode.window.showWarningMessage(
          `Not a folder (pick a submodule or folder): ${uri.fsPath}`,
        );
        return;
      }

      const gitExt = vscode.extensions.getExtension("vscode.git");
      if (!gitExt) {
        vscode.window.showErrorMessage(
          "Built-in Git extension is not available.",
        );
        return;
      }

      const gitExports = gitExt.isActive
        ? gitExt.exports
        : await gitExt.activate();
      const api = gitExports.getAPI(1);

      try {
        // The Git API skips repos the user previously closed. The built-in
        // command passes openIfClosed=true so they can be reopened.
        await vscode.commands.executeCommand("git.openRepository", uri.fsPath);
        const repo = api.getRepository(uri);
        if (repo) {
          vscode.window.showInformationMessage(
            `Opened git repository: ${uri.fsPath}`,
          );
        } else {
          vscode.window.showWarningMessage(
            `No git repository found at: ${uri.fsPath}`,
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to open repository: ${err.message}`,
        );
      }
    },
  );

  const githubCmd = vscode.commands.registerCommand(
    "openOnGitHub.run",
    async (uriFromContextMenu) => {
      try {
        await openOnGitHub(uriFromContextMenu);
      } catch (err) {
        vscode.window.showErrorMessage(`Open on GitHub failed: ${err.message}`);
      }
    },
  );

  context.subscriptions.push(cmd, githubCmd);
}

function deactivate() {}

module.exports = { activate, deactivate };
