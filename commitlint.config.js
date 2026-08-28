export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // The scope is the module or area: feat(config), fix(merge), test(detect).
    'scope-case': [2, 'always', 'kebab-case'],
    // Micro commits describe one action; keep the subject short enough to scan in a log.
    'header-max-length': [2, 'always', 72],
  },
};
