; Scopes
(fn_expression) @local.scope
(let_expression) @local.scope
(list_for_item) @local.scope
(dict_for_item) @local.scope
(case_clause) @local.scope

; Definitions
;
; A `let` binder and a function parameter are patterns, so the binding-pattern
; rule below covers them along with the binders inside a `case` pattern —
; whether the pattern is a bare name or destructures.
(list_for_item
  variable: (identifier) @local.definition)
(dict_for_item
  variable: (identifier) @local.definition)
(catch_clause
  binding: (identifier) @local.definition)
(binding_pattern
  name: (identifier) @local.definition)

; References
(identifier) @local.reference
