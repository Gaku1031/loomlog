# Releasing loomlog

Publishing is automated. **Bump the version on `main` and a new npm release goes out** —
no manual `npm publish`, no long-lived tokens.

## How it works

- **`.github/workflows/ci.yml`** runs `typecheck` + tests on every push and PR (Node 20 & 22).
- **`.github/workflows/publish.yml`** runs on every push to `main`:
  1. install, typecheck, test, build,
  2. compare `package.json`'s `version` against what's already on npm,
  3. if it's a **new** version → `npm publish` (otherwise it no-ops, so ordinary
     commits to `main` are safe),
  4. tag `vX.Y.Z` and cut a GitHub Release.

Auth uses **npm Trusted Publishing (OIDC)**: GitHub mints a short-lived token at publish
time, so there is no `NPM_TOKEN` secret to leak or rotate, and every release gets a signed
[provenance](https://docs.npmjs.com/generating-provenance-statements) attestation.

## Cutting a release

```bash
npm version patch   # or: minor | major  → bumps package.json + package-lock.json, makes a commit
git push origin main
```

That's it. Watch the run under the repo's **Actions** tab. To verify afterwards:

```bash
npm view loomlog version
npm view loomlog --json | grep -A3 provenance   # provenance present
```

> A plain `git push` to `main` that doesn't change the version just runs CI and skips the
> publish step — bumping the version is the only thing that triggers a release.

## One-time setup (required before the first automated publish)

### 1. Register the GitHub Actions workflow as a Trusted Publisher on npm

1. Sign in at <https://www.npmjs.com> as the package owner (`gaku1031`).
2. Go to the **loomlog** package → **Settings** → **Trusted Publishers** (a.k.a. "Publishing
   access" / "OIDC").
3. Add a **GitHub Actions** publisher with:
   - **Organization / user:** `Gaku1031`
   - **Repository:** `loomlog`
   - **Workflow filename:** `publish.yml`
   - **Environment:** *(leave blank — the workflow does not use a GitHub Environment)*
4. Save.

Until this is configured, the publish step will fail with an auth error (CI/typecheck/test
still pass).

### 2. Point the GitHub repo's default branch at `main`

The branch was renamed `master → main` locally. After the first `git push -u origin main`:

1. GitHub → repo **Settings** → **Branches** → set **default branch** to `main`.
2. Delete the old remote branch once nothing depends on it:
   ```bash
   git push origin --delete master
   ```

That's all — subsequent releases are just `npm version` + `git push`.
