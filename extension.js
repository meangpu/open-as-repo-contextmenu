const vscode = require("vscode");

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

  context.subscriptions.push(cmd);
}

function deactivate() {}

module.exports = { activate, deactivate };
