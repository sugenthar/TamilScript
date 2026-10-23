'use strict';

/**
 * Authoritative Tamil keyword registry.
 *
 * This file is the single place where a Tamil word, its JavaScript spelling,
 * its implementation status, and its scanner context are defined. Do not add
 * parallel word lists in the scanner, CLI, editor or documentation tests:
 * import from here instead.
 *
 * Status values:
 *   - implemented: rewritten to `js` when Tamil keyword mode is enabled.
 *   - helper:      not a keyword; an explicitly imported runtime helper.
 *   - deferred:    documented proposal without an implementation yet.
 */
const DEFINITIONS = Object.freeze([
  {
    tamil: 'என்றால்',
    js: 'if',
    status: 'implemented',
    role: 'control',
    controlCondition: true,
    description: 'conditional statement',
  },
  {
    tamil: 'இல்லை',
    js: 'else',
    status: 'implemented',
    role: 'control',
    regexAllowed: true,
    statementAfter: true,
    description: 'alternative branch',
  },
  {
    tamil: 'நிறுத்து',
    js: 'break',
    status: 'implemented',
    role: 'control',
    description: 'break out of a loop or switch',
  },
  {
    tamil: 'தொடர்',
    js: 'continue',
    status: 'implemented',
    role: 'control',
    description: 'continue the next loop iteration',
  },
  {
    tamil: 'ஒவ்வொரு',
    js: 'for',
    status: 'implemented',
    role: 'loop',
    controlCondition: true,
    description: 'loop header; document the for...of form',
  },
  {
    tamil: 'செயல்',
    js: 'function',
    status: 'implemented',
    role: 'declaration',
    functionHeader: true,
    description: 'function declaration or expression',
  },
  {
    tamil: 'கொடு',
    js: 'return',
    status: 'implemented',
    role: 'control',
    regexAllowed: true,
    description: 'return from a function',
  },
  {
    tamil: 'வகுப்பு',
    js: 'class',
    status: 'implemented',
    role: 'declaration',
    classHeader: true,
    description: 'class declaration or expression',
  },
  {
    tamil: 'உருவாக்கு',
    js: 'constructor',
    status: 'implemented',
    role: 'member',
    description: 'class constructor method name',
  },
  {
    tamil: 'இது',
    js: 'this',
    status: 'implemented',
    role: 'value',
    valueKeyword: true,
    description: 'current object reference',
  },
  {
    tamil: 'மேல்',
    js: 'super',
    status: 'implemented',
    role: 'value',
    valueKeyword: true,
    description: 'parent class reference',
  },
  {
    tamil: 'சேர்தல்',
    js: 'extends',
    status: 'implemented',
    role: 'class',
    description: 'class inheritance clause',
  },

  {
    tamil: 'செயல்படுத்து',
    js: 'implements',
    status: 'deferred',
    role: 'class',
    reason: 'JavaScript has no implements clause; erasing or checking it needs class grammar and semantic analysis.',
  },
  {
    tamil: 'பொது',
    js: 'public',
    status: 'deferred',
    role: 'modifier',
    reason: 'JavaScript has no public modifier; erasing it requires class-member grammar.',
  },
  {
    tamil: 'தனி',
    js: 'private',
    status: 'deferred',
    role: 'modifier',
    reason: 'Mapping to # fields changes syntax and needs class-member grammar; private methods and static members need separate rules.',
  },
  {
    tamil: 'இடைமுகம்',
    js: 'interface',
    status: 'deferred',
    role: 'type-declaration',
    reason: 'Interfaces are type-only and require a type parser, checker, and complete erasure rules.',
  },
  {
    tamil: 'எண்ணகம்',
    js: 'enum',
    status: 'deferred',
    role: 'type-declaration',
    reason: 'An enum needs defined runtime object semantics, numeric/string member rules, and code generation.',
  },
  {
    tamil: 'எண்',
    js: null,
    status: 'helper',
    role: 'type-or-helper',
    helper: 'எண்',
    description: 'number conversion helper; type-annotation syntax is deferred',
  },
  {
    tamil: 'சொல்',
    js: null,
    status: 'helper',
    role: 'type-or-helper',
    helper: 'சொல்',
    description: 'string conversion helper; type-annotation syntax is deferred',
  },
  {
    tamil: 'வெற்று',
    js: 'void',
    status: 'deferred',
    role: 'type',
    reason: 'void is type-only in the proposed syntax and needs a type parser and erasure rules.',
  },
  {
    tamil: 'தொகுப்பு',
    js: 'package',
    status: 'deferred',
    role: 'module',
    reason: 'JavaScript has no package declaration; inventing runtime semantics would be misleading.',
  },
  {
    tamil: 'சேர்',
    js: null,
    status: 'helper',
    role: 'collection-helper',
    helper: 'சேர்',
    description: 'append one or more values to an array or Set',
  },
  {
    tamil: 'நீளம்',
    js: null,
    status: 'helper',
    role: 'collection-helper',
    helper: 'நீளம்',
    description: 'read .length or .size from a collection',
  },
]);

module.exports = {
  DEFINITIONS,
};
