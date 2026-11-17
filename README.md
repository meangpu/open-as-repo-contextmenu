### open-as-git-repo

make it easy to do open file as repo by right click

### note for myself

install this first

```sh
npm install -g @vscode/vsce
```

to make local install package

```sh
vsce package
```

to update on the marketplace (no PAT: new global PATs can no longer be made)

1. commit everything first (`npm version` refuses a dirty git tree)
2. run the VS Code task `release: bump patch + package .vsix` (`Ctrl+Shift+P` > `Tasks: Run Task`), or `npm run release`. It deletes old `.vsix` files, then runs `vsce package patch` to bump the version (0.0.8 -> 0.0.9), commit and tag it, and make the new `.vsix`
3. open <https://marketplace.visualstudio.com/manage/publishers/meangpu> and sign in
4. on the extension click `...` then `Update`, and upload the `.vsix`
5. wait a few minutes for the marketplace to verify it
