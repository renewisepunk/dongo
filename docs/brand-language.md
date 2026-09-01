# dongo brand language

The product name is always written `dongo`, including at the start of a sentence and in UI headings, CLI output, emails, metadata, documentation, and accessibility labels.

PascalCase source identifiers such as TypeScript type and function names are implementation symbols, not displayed brand copy. User-created data, including project and organization names, is preserved and displayed exactly as the user entered it.

Canonical Work identifiers are lowercase, compact, and separator-free. They
match `[a-z]{4}[0-9]{3}`, such as `dong012`; UI copy, links, search results, and
exports use that canonical value. An exact retained legacy identifier may be
accepted for project-scoped lookup, but it is compatibility metadata rather
than preferred display copy.

Run `npm run verify:brand-case` to reject title-case or all-caps static product
copy in source strings, documentation, inline examples, fenced code, HTML, and
structured text assets. The narrow compatibility allowlist covers exact legacy
Work identifiers such as `DONGO-12`, legacy identifier-prefix fixtures,
environment variables such as `DONGO_TOKEN`, `DONGO.managed.md`, and runtime
normalization regression inputs. Do not add an exception for ordinary display
copy.

The original PRD (`dongo-prd.md`) remains intentionally excluded and immutable.
Historical release evidence may retain exact previously observed strings when
rewriting them would falsify the record.
