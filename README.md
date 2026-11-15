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
2. `vsce package patch` to bump the version (0.0.6 -> 0.0.7), commit and tag it, and make the `.vsix`
3. open <https://marketplace.visualstudio.com/manage/publishers/meangpu> and sign in
4. on the extension click `...` then `Update`, and upload the `.vsix`
5. wait a few minutes for the marketplace to verify it
