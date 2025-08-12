#!/bin/sh

git switch main

git config set --local user.name "github-actions[bot]"
git config set --local user.email "41898282+github-actions[bot]@users.noreply.github.com"

git rebase --force --no-gpg-sign dev

git config unset --local user.name
git config unset --local user.email