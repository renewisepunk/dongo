# dongo brand language

The product name is always written `dongo`, including at the start of a sentence and in UI headings, CLI output, emails, metadata, documentation, and accessibility labels.

PascalCase source identifiers such as TypeScript type and function names are implementation symbols, not displayed brand copy. User-created data, including project and organization names, is preserved and displayed exactly as the user entered it.

Run `npm run verify:brand-case` to reject uppercase static product copy. The original PRD (`dongo-prd.md`) is intentionally excluded and remains immutable.
