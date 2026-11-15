# Publishing the repository

The repository includes an MIT license, contribution guidance, deployment documentation, and GitHub Actions checks. `package.json` stays `private: true` to prevent accidental npm publication; this does not prevent a public Git repository.

## Review before the first push

```sh
npm run check
npm test
git status --short
git diff --cached --stat
```

`.gitignore` excludes dependencies, local environment files, IDE settings, logs, and generated archives. `.dockerignore` allows only relay build inputs. Inspect staged files before committing. `.env.example` contains placeholders only.

## First commit and push

Create an empty public repository on your Git host, without a generated README/license/gitignore because these already exist. From this project's root (Git is initialized on `main`):

```sh
git add .
git diff --cached --stat
git commit -m "chore: prepare project for public release"
git remote add origin https://github.com/YOUR_USERNAME/netmirror-watch-party.git
git push -u origin main
```

Replace `YOUR_USERNAME` and the repository name as needed. If a remote already exists, inspect `git remote -v` before changing it. If an initial commit has already been made, omit the commit step.

On GitHub, enable Actions, private vulnerability reporting, and branch protection requiring successful CI. Add a repository description and topics such as `watch-party`, `browser-extension`, `websocket`, and `self-hosted`.

## Sharing releases

After a version is tested, update the extension manifest and package version together, tag the commit, and attach an archive of `extension/` if useful. Users still need to load the extension root in Developer mode. Browser-store publication, Safari packaging, and container-registry publication are separate workflows and are not configured automatically.

Document the relay version/image used by a public deployment. A server restart ends rooms, so schedule updates accordingly.
