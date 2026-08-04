# Feishu E2E regression setup

These tests use the real unpacked extension and real Feishu `user_change` API calls. Create two disposable documents owned by a dedicated test account:

- a Docx URL (`.../docx/<token>`);
- a Wiki URL (`.../wiki/<token>`).

The paste feature replaces content from the cursor onward, so never point these variables at a working document.

```bash
cd apps/chrome-extension
mkdir -p .e2e
cp e2e/feishu.env.example .e2e/feishu.env
```

Replace both URLs in `.e2e/feishu.env`, then export them before every command:

```bash
set -a
. .e2e/feishu.env
set +a
```

Install Playwright's Chromium once:

```bash
pnpm e2e:install
```

Authenticate once. A headed Chromium window opens using the ignored `.e2e/feishu-profile` directory. Log in to Feishu and wait until the command completes:

```bash
pnpm test:e2e:auth
```

Run the three serial E2E regressions:

```bash
pnpm test:e2e
```

The suite checks:

1. The wiki-link fixture is accepted when pasted into a Docx document and carries the expected wiki token.
2. Pasting works when the target page itself has a `/wiki/` URL.
3. The table request uses a larger width for the longer column and Feishu accepts it.
