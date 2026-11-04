# Changelog

## 0.1.2

- Texts follow the n8n UX guidelines: actions without articles ('Get recipe submission status', 'Replace all recipes
  in store'), field names in single quotes, an 'e.g.' placeholder, and every node message says how to fix it.
- README: the answer of Validate Only (`resultado: so_validado`, `gravado: false`).

## 0.1.1

- The package no longer ships the TypeScript build cache (`dist/tsconfig.tsbuildinfo`): 95 kB less, no change in
  behavior.
- First version published through npm trusted publishing (OIDC), with provenance.

## 0.1.0

- First version: the Farol API credential and the Farol node, with the Recipe resource (Get Status and Replace All,
  with Validate Only).
