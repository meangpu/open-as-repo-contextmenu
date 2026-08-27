const vscode = require("vscode");
function activate(context) {
  const cmd = vscode.commands.registerCommand("openAsGitRepo.run", async (uri) => {
    if (!uri) {
      vscode.window.showErrorMessage("No folder was targeted.");
      return;
    }
    const gitExt = vscode.extensions.getExtension("vscode.git");
    if (!gitExt) {
      vscode.window.showErrorMessage("Built-in Git extension is not available.");
      return;
    }
    const gitExports = gitExt.isActive ? gitExt.exports : await gitExt.activate();
    const api = gitExports.getAPI(1);
    try {
      const repo = await api.openRepository(uri);
      if (repo) {
        vscode.window.showInformationMessage(`Opened git repository: ${uri.fsPath}`);
      } else {
        vscode.window.showWarningMessage(`No git repository found at: ${uri.fsPath}`);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to open repository: ${err.message}`);
    }
  });
  context.subscriptions.push(cmd);
}

function deactivate() {}

module.exports = { activate, deactivate };
