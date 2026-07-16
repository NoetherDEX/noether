/**
 * Commit message rules for the Noether monorepo.
 * See docs/GIT_WORKFLOW.md for the full policy.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  // Grandfathered: one pre-existing staging commit (2026-07-10, docs-site
  // day) has a 103-char subject. It predates PR-range linting (this job only
  // runs on pull_request, never on staging pushes) and sits ~75 commits deep
  // behind a merge commit — rewriting shared release-branch history to fix a
  // lint header is worse than a scoped exemption. The 100-char rule stays
  // enforced for every new commit.
  ignores: [
    (message) => message.startsWith('docs(readme): refresh for 2026-07 state'),
  ],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'chore',
        'refactor',
        'test',
        'perf',
        'ci',
        'build',
        'revert',
      ],
    ],
    'subject-case': [0],
    'scope-empty': [0],
    'header-max-length': [2, 'always', 100],
  },
};
