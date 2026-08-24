; Keywords
"import" @keyword
"let" @keyword
"fn" @keyword.function
"export" @keyword
"extern" @keyword
"if" @keyword.conditional
"else" @keyword.conditional
"for" @keyword.repeat
"in" @keyword
"type" @keyword
"enum" @keyword
"exception" @keyword
"raise" @keyword
"try" @keyword
"catch" @keyword
"switch" @keyword.conditional
"case" @keyword.conditional
"with" @keyword
"as" @keyword

; Literals
(integer) @number
(float) @number.float
(boolean) @constant.builtin
(nil) @constant.builtin

; Annotations (the `@` and the name; arguments highlight as their own literals)
(annotation
  "@" @attribute
  name: (identifier) @attribute)

; Atoms and enum variants (the label only; payloads highlight as their own kind)
(atom label: (identifier) @constant)
(enum_variant label: (identifier) @constant)

; Patterns — a `case` arm, a `let` binder and a function parameter alike
(variant_pattern label: (identifier) @constant)
(nil_pattern) @constant.builtin
(wildcard_pattern) @variable.builtin
(binding_pattern name: (identifier) @variable)

; Paths
(path_expression) @string.special.path

; Strings
(string) @string
(string_content) @string
(interpolation
  "{" @punctuation.special
  "}" @punctuation.special)

; Comments
(comment) @comment

; Operators
(binary_expression
  operator: _ @operator)
(unary_expression
  operator: _ @operator)

; The `?` that marks an optional type, and the `?.` that chains through one.
(optional_chain) @operator
(optional_type
  "?" @operator)

; Functions
(call_expression
  function: (identifier) @function.call)
(call_expression
  function: (property_access
    property: (identifier) @function.method.call))

; Type casts
(type_cast
  type: (type_identifier) @type)

; Types
(type_declaration
  name: (identifier) @type.definition)
(export_type_declaration
  (type_declaration
    name: (identifier) @type.definition))
(type_identifier) @type
(fn_parameter
  type: (type_identifier) @type)

; Generics — a declared type parameter is a type name like any other, and the
; angle brackets delimiting parameters and arguments are brackets, not the
; comparison operators they share their spelling with.
(type_parameter
  name: (identifier) @type)
(type_parameters
  "<" @punctuation.bracket
  ">" @punctuation.bracket)
(type_arguments
  "<" @punctuation.bracket
  ">" @punctuation.bracket)

; Properties
(property_access
  property: (identifier) @property)
(record_field
  name: (identifier) @property)
(record_type_field
  name: (identifier) @property)

; Variables
;
; A `let` binder and a function parameter are patterns, so their names come
; from the binding-pattern rule above; a parameter's own name refines that to
; the parameter highlight.
(fn_parameter
  pattern: (binding_pattern
    name: (identifier) @variable.parameter))
(list_for_item
  variable: (identifier) @variable)
(dict_for_item
  variable: (identifier) @variable)
(catch_clause
  binding: (identifier) @variable)
(catch_clause
  exception: (identifier) @type)

; Imports
(import_path
  (import_fragment) @module)
(import_statement
  alias: (identifier) @module)

; Punctuation
"(" @punctuation.bracket
")" @punctuation.bracket
"[" @punctuation.bracket
"]" @punctuation.bracket
"{" @punctuation.bracket
"}" @punctuation.bracket
":" @punctuation.delimiter
"," @punctuation.delimiter
"." @punctuation.delimiter
";" @punctuation.delimiter
"=" @operator
"#" @punctuation.special
"<:" @operator
