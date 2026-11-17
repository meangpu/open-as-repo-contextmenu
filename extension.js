const vscode = require("vscode");
const path = require("path");

// The built-in Git extension's API, or undefined if it is missing.
async function getGitApi() {
  const gitExt = vscode.extensions.getExtension("vscode.git");
  if (!gitExt) {
    vscode.window.showErrorMessage("Built-in Git extension is not available.");
    return undefined;
  }
  const gitExports = gitExt.isActive ? gitExt.exports : await gitExt.activate();
  return gitExports.getAPI(1);
}

// Resolves to the stat, or undefined when the path does not exist.
function statOrUndefined(uri) {
  return vscode.workspace.fs.stat(uri).then(
    (s) => s,
    () => undefined,
  );
}

// Bitwise: a symlinked folder is Directory | SymbolicLink.
function isFolder(stat) {
  return Boolean(stat && stat.type & vscode.FileType.Directory);
}

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

  const api = await getGitApi();
  if (!api) return;

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

  const kind = isFolder(await vscode.workspace.fs.stat(uri)) ? "tree" : "blob";
  const relPath = path
    .relative(repo.rootUri.fsPath, uri.fsPath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join("/");

  const url = `https://github.com/${remote.owner}/${remote.repo}/${kind}/${ref}/${relPath}`;
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

// Changed submodules across every open repo, read from the Git API (no disk access).
// One: use it. Several: ask. None: undefined.
async function pickChangedSubmodule(api) {
  const byPath = new Map();
  for (const repo of api.repositories) {
    const subPaths = new Set(
      repo.state.submodules.map((s) => path.join(repo.rootUri.fsPath, s.path)),
    );
    for (const change of [...repo.state.indexChanges, ...repo.state.workingTreeChanges]) {
      if (subPaths.has(change.uri.fsPath)) byPath.set(change.uri.fsPath, change.uri);
    }
  }

  const folders = [...byPath.values()];
  if (folders.length <= 1) {
    return folders[0];
  }
  const picked = await vscode.window.showQuickPick(
    folders.map((uri) => ({ label: path.basename(uri.fsPath), description: uri.fsPath, uri })),
    { placeHolder: "Changed submodule to open as a Git repository" },
  );
  return picked?.uri;
}

// The file path behind an editor tab: plain file, diff (right side), or the
// git: URI the Git extension opens for a submodule (path is in the query).
function tabUri(tab) {
  const input = tab?.input;
  const uri = input?.modified ?? input?.uri;
  if (!uri) return undefined;
  if (uri.scheme === "git") {
    try {
      return vscode.Uri.file(JSON.parse(uri.query).path);
    } catch {
      return undefined;
    }
  }
  return uri.scheme === "file" ? uri : undefined;
}

// VS Code gives keybindings no access to the Source Control selection. Enter
// (list.select) on a row runs that row's open command, so press it, read the
// path from the editor it opens, then close that editor and refocus the view.
async function scmSelectionUri() {
  const before = new Set(vscode.window.tabGroups.all.flatMap((g) => g.tabs));
  const active = () => vscode.window.tabGroups.activeTabGroup.activeTab;
  const activeBefore = active();

  // Resolve on the first tab change instead of polling; give up after 1 s
  // (e.g. a repository header row opens nothing).
  let stopWaiting;
  const opened = new Promise((resolve) => {
    const sub = vscode.window.tabGroups.onDidChangeTabs(() => {
      if (active() !== activeBefore) stopWaiting();
    });
    const timer = setTimeout(() => stopWaiting(), 1000);
    stopWaiting = () => {
      sub.dispose();
      clearTimeout(timer);
      resolve(active());
    };
  });
  try {
    await vscode.commands.executeCommand("list.select");
  } catch (err) {
    stopWaiting();
    throw err;
  }
  const tab = await opened;

  const uri = tabUri(tab);
  if (tab && tab !== activeBefore) {
    // Tidy up without blocking: the repo can open meanwhile.
    if (!before.has(tab)) vscode.window.tabGroups.close(tab);
    vscode.commands.executeCommand("workbench.scm.focus");
  }
  return uri;
}

// The Explorer selection, read by borrowing copyFilePath and the clipboard,
// since keybindings get no URI.
async function explorerSelectionUri() {
  const previousClipboard = await vscode.env.clipboard.readText();
  try {
    await vscode.commands.executeCommand("copyFilePath");
    // Multi-select copies several paths, one per line: use the first.
    const firstPath = (await vscode.env.clipboard.readText()).split(/\r?\n/)[0].trim();
    return firstPath ? vscode.Uri.file(firstPath) : undefined;
  } finally {
    await vscode.env.clipboard.writeText(previousClipboard);
  }
}

async function resolveTargetUri(arg, api) {
  // Source Control menu passes a resource state (e.g. a changed submodule), not a URI.
  if (arg?.resourceUri) {
    return arg.resourceUri;
  }
  // Keybinding in Source Control: use the focused row; if that gives nothing,
  // offer the changed submodules instead.
  if (arg?.fromScm) {
    return (await scmSelectionUri()) ?? pickChangedSubmodule(api);
  }
  // Explorer menu passes the clicked URI.
  if (arg) {
    return arg;
  }
  return explorerSelectionUri();
}

async function openAsGitRepo(arg) {
  const api = await getGitApi();
  if (!api) return;

  const uri = await resolveTargetUri(arg, api);
  if (!uri) {
    vscode.window.showErrorMessage("No folder is selected.");
    return;
  }

  // A plain file (e.g. a changed file in Source Control) is not a repo root;
  // without this the parent repo would be reported as "opened".
  if (!isFolder(await statOrUndefined(uri))) {
    vscode.window.showWarningMessage(`Not a folder (pick a submodule or folder): ${uri.fsPath}`);
    return;
  }

  // The Git API skips repos the user previously closed. The built-in
  // command passes openIfClosed=true so they can be reopened.
  await vscode.commands.executeCommand("git.openRepository", uri.fsPath);
  if (api.getRepository(uri)) {
    vscode.window.showInformationMessage(`Opened git repository: ${uri.fsPath}`);
  } else {
    vscode.window.showWarningMessage(`No git repository found at: ${uri.fsPath}`);
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("openAsGitRepo.run", async (arg) => {
      try {
        await openAsGitRepo(arg);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to open repository: ${err.message}`);
      }
    }),
    vscode.commands.registerCommand("openOnGitHub.run", async (arg) => {
      try {
        await openOnGitHub(arg);
      } catch (err) {
        vscode.window.showErrorMessage(`Open on GitHub failed: ${err.message}`);
      }
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
