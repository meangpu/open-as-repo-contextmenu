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

async function resolveTargetUri(uriFromContextMenu) {
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
