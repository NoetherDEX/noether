/**
 * Commit message rules for the Noether monorepo.
 * See docs/GIT_WORKFLOW.md for the full policy.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
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
