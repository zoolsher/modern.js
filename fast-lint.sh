#!/usr/bin/env bash

TARGET_BRANCH=origin/main
if [ ! -z ${GITHUB_BASE_REF+x} ]; then
  git fetch origin ${GITHUB_BASE_REF}
  TARGET_BRANCH=origin/${GITHUB_BASE_REF}
fi

# build @modern-js/eslint-config and related packages
pnpm run build --filter @modern-js/eslint-config...

# run eslint --no-fix
npx eslint --format codeframe $(git diff ${TARGET_BRANCH}... --name-only | grep -E '\.(js|jsx|ts|tsx|mjs|mjsx|cjs|cjsx)$')
