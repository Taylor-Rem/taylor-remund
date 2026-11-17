# taylorremund.com

**Branch `rewrite`: the workshop.** An interactive miniature factory on a workbench that
happens to contain Taylor Remund's résumé. `main` is still the live plain-HTML site, and
stays that way until the cutover. `REWRITE.md` is the specification and the plan;
`CLAUDE.md` is the operating manual for this branch.

Astro (static), TypeScript, Three.js and Rapier. Hosted on GitHub Pages.

```
npm ci
npm run dev       # the site, with dev-only pages under /dev/
npm run verify    # typecheck, tests, build, and every check (URLs, legal text, links, budgets, layers, claims)
```

- `/` — the stage (the workshop) with the strip and the paperwork in plain HTML.
- `/resume/` — the employer material. Never depends on WebGL.
- `/ai/` — the services page: the AI working session and the computer install, with prices.
- `/privacy/`, `/terms/`, `/sms/` — the legal pages Twilio's 10DLC campaign lists; built byte for
  byte from `legal-reference/`.

The old site is kept under `legacy/` for the migration.

## Custom domain: taylorremund.com

The repo contains a `CNAME` file with `taylorremund.com`, so GitHub Pages will claim the domain automatically once DNS points at it. At the domain registrar:

1. Add four **A records** for the apex (`@`) pointing to GitHub Pages:
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
2. Add a **CNAME record** for `www` pointing to `<github-username>.github.io`.
3. In the repo: **Settings → Pages → Custom domain** — enter `taylorremund.com`, wait for the DNS check, then tick **Enforce HTTPS** (the certificate takes a few minutes to issue).

DNS changes can take up to a few hours to propagate. Verify with `dig taylorremund.com +noall +answer`.
