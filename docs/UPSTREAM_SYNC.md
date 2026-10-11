# Following DSH releases (upstream sync)

Atelier is built on [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) by DeepSeek-AI (MIT). The `harness/` folder is DSH at one release plus Atelier's changes; `harness/UPSTREAM.json` records which release. When DeepSeek publishes a new DSH release, Atelier follows with this procedure. It is for maintainers; users get the result through [updates](INSTALL.md#updates).

Nothing in it adds a git remote to this repository or pushes anything. The upstream checkout lives in `.upstream-cache/` (ignored by git).

## Requirements

Git, Node.js 24 with corepack, and enough disk for a DSH checkout and its build (about 3 GB). Windows or Linux/WSL; on Windows use `scripts\sync-upstream.ps1`, on Linux/WSL `scripts/sync-upstream` (both run `scripts/sync-upstream.mjs`).

## The steps

1. **See what is new.**

   ```sh
   scripts/sync-upstream status
   ```

   It prints the DSH release Atelier is on and every newer `dsh-v*` release tag.

2. **Prepare the new release with Atelier's changes.**

   ```sh
   scripts/sync-upstream prepare --to dsh-v0.2.1-alpha.2
   ```

   In `.upstream-cache/work` this checks out the release Atelier is based on, records all of Atelier's changes as one commit, and replays that commit onto the new release with git. Then it builds the result with DSH's own toolchain (`pnpm install`, `pnpm run build`; add `--upstream-tests` to also run DSH's test suite).

   **If git reports conflicts**, the script lists the files and stops. Resolve them in `.upstream-cache/work` (edit, `git add`, `git rebase --continue`), then run `scripts/sync-upstream continue` to build.

3. **Apply it on a new branch and smoke-test.**

   ```sh
   scripts/sync-upstream apply
   ```

   This creates the branch `upstream/<release>` here, copies the rebuilt packages (sources and built `lib/`) into `harness/`, updates `harness/UPSTREAM.json` and the lockfile, runs `node scripts/smoke-test.mjs` (starts Atelier on port 3390 against a stand-in model and checks the web app, the login token and the Atelier plugins), and commits. New packages that DSH added are listed, not copied: add the ones Atelier needs by hand (in `harness/apps/cli/package.json` and the root `package.json`).

4. **Review and test by hand.** Read the diff, start Atelier, run a Vitruvius chat against a real model, and check Settings > Updates and Model roles.

5. **Release.** Merge the branch into `main`, raise the version in `package.json`, then:

   ```sh
   scripts/sync-upstream tag                           # local annotated tag v<version>
   powershell -File packaging\build-release.ps1        # Windows installer, Linux/WSL archive, SHA256SUMS, notes
   ```

   Push the tag and publish the release yourself (owner only).

## Keeping every version

- Every release is a git tag (`v0.1.0`, `v0.1.1`, ...) and a GitHub release whose assets stay published. Never delete an old release; its installer is someone's rollback.
- Each release's `dist-release/` folder (installer, archive, `SHA256SUMS`, `RELEASE_NOTES.md`) is also kept in ARCITECH's own archive.
- On users' computers, an update installs next to the running version and keeps the previous one, so **Roll back** in Settings > Updates (or `atelier update rollback`) works without a download. Atelier keeps the current version, the previous one and one more.

## Smoke test on its own

```sh
node scripts/smoke-test.mjs                         # this checkout
node scripts/smoke-test.mjs --app <installed app>   # an installed copy, e.g. ...\Atelier-Preview\versions\0.1.0\app
```

It uses a throwaway home folder and port 3390, and stops exactly the processes it started.
