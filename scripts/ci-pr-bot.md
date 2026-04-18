# PR Comment Bot (GitHub App)

This repository can post a sticky PR comment with a link to the consolidated E2E failed-tests HTML report. It prefers a GitHub App for authentication so comments come from a bot user.

## Environment variables

Provide either a GitHub App OR a classic token. The script prefers the App.

GitHub App (preferred):
- CI_PR_BOT_APP_ID — Your GitHub App ID
- CI_PR_BOT_INSTALLATION_ID — Installation ID for this repo/org
- CI_PR_BOT_PRIVATE_KEY — Contents of the App private key (PEM). Multi-line is fine; literal `\n` is also accepted.

Fallback (legacy):
- APP_ID, INSTALLATION_ID, APP_PRIVATE_KEY — Legacy names still supported
- GH_PR_COMMENT_TOKEN — Personal access token (only used if no App credentials are present)

Other required:
- CIRCLECI_TOKEN — Needed to read artifacts from CircleCI API

Optional:
- REPORT_SET_STATUS=1 — Also sets a commit status that links to the HTML report

## Local test (optional)

1. Export secrets (example):

```zsh
export CI_PR_BOT_APP_ID=123456
export CI_PR_BOT_INSTALLATION_ID=9876543
export CI_PR_BOT_PRIVATE_KEY="$(cat ~/Downloads/ci-comment-app.private-key.pem)"
export CIRCLECI_TOKEN=xxxxx
# These are usually set in CI, but for local dry-runs you can provide them:
export CIRCLE_PROJECT_USERNAME=remix-project-org
export CIRCLE_PROJECT_REPONAME=remix-project
export CIRCLE_PROJECT_SLUG=gh/${CIRCLE_PROJECT_USERNAME}/${CIRCLE_PROJECT_REPONAME}
export CIRCLE_BUILD_NUM=123456789
export CIRCLE_PULL_REQUESTS="https://github.com/${CIRCLE_PROJECT_USERNAME}/${CIRCLE_PROJECT_REPONAME}/pull/1234"
export CIRCLE_SHA1=$(git rev-parse HEAD)
```

2. Ensure `reports/ci-latest-failed/index.html` and `summary.json` exist (from a prior CI artifact or by running the generator).

3. Post the PR comment:

```zsh
yarn ci:post-pr-report
```

In CI, the `post-failed-report` job runs this automatically after the shards finish.
