/// <reference types="tree-sitter-cli/dsl" />

const PREC = {
  // The discard operator `;` is the lowest level: a chain is a whole
  // expression, never an operand of one. Its precedence only has to beat
  // reducing a bare sub-discard expression to `_expression`, so that a `;`
  // reached in an ordinary position starts a chain instead of ending one.
  DISCARD: 1,
  OR: 2,
  NIL_COALESCE: 3,
  AND: 4,
  EQUALITY: 5,
  COMPARISON: 6,
  ADDITIVE: 7,
  MULTIPLICATIVE: 8,
  UNARY: 9,
  POSTFIX: 10,
};

// The expression rules that exist in two flavors — see the "Expressions"
// comment below. The reserved twin of `foo` is the hidden rule
// `_reserved_foo`, aliased back to `foo` wherever it is used.
const FLAVORED = [
  "_core_expression",
  "if_expression",
  "let_expression",
  "fn_expression",
  "raise_expression",
  "try_expression",
  "catch_clause",
  "switch_expression",
  "case_clause",
  "with_expression",
  "binary_expression",
  "unary_expression",
  "type_cast",
  "call_expression",
  "property_access",
  "indexed_access",
];

module.exports = grammar({
  name: "scl",

  extras: ($) => [/\s/, $.comment],

  word: ($) => $.identifier,

  externals: ($) => [$.string_content],

  conflicts: ($) => [
    ...bothFlavors($, ["binary_expression", "unary_expression", "call_expression"]),
    ...bothFlavors($, ["binary_expression", "call_expression"]),
    [$._atom_expression, $._type_expression_base],
    // An untyped parameter makes `fn(a, …` ambiguous between a `fn` expression
    // and a `fn` type until the closing paren's continuation settles it.
    [$.fn_parameter, $._type_expression_base],
    [$.record, $.record_type],
    [$.if_expression, $._list_item],
    [$.binary_expression, $.path_expression],
  ],

  rules: {
    // ── Top-level ──────────────────────────────────────────────

    source_file: ($) => repeat($._mod_stmt),

    // A module statement has no terminator token — statements are delimited by
    // juxtaposition — so statement level is a reservation context: a `;`
    // written after one would otherwise pull the following statement into it.
    _mod_stmt: ($) =>
      choice(
        $.annotated_statement,
        $.import_statement,
        $.export_type_declaration,
        $.export_statement,
        $.type_declaration,
        $._reserved_core_expression,
        $.let_binding,
      ),

    // An annotation marks the module statement it heads. Its operand is itself
    // a module statement, so annotations stack: `@a @b let x = 1` is one
    // statement bearing two of them.
    annotated_statement: ($) => seq($.annotation, $._mod_stmt),

    // `@name`, optionally with a parenthesised argument list. The list binds
    // tightly to the name, as an atom's payload binds to its label, so a `(`
    // after an annotation opens the list rather than a parenthesized statement.
    annotation: ($) =>
      prec.right(seq("@", field("name", $.identifier), optional($.annotation_arguments))),

    annotation_arguments: ($) => seq("(", commaSep1($._annotation_argument), ")"),

    // Annotation arguments are literals: an annotation is a constant of the
    // program text, resolved before anything is evaluated.
    _annotation_argument: ($) =>
      choice(
        $.signed_number,
        $.float,
        $.integer,
        $.string,
        $.boolean,
        $.nil,
      ),

    signed_number: ($) => seq("-", choice($.float, $.integer)),

    // ── Statements ─────────────────────────────────────────────

    import_statement: ($) =>
      seq(
        "import",
        $.import_path,
        optional(seq("as", field("alias", $.identifier))),
      ),

    import_path: ($) =>
      prec.right(seq($.import_fragment, repeat(seq("/", $.import_fragment)))),

    // An import path fragment: `symbol ('-' Int? symbol)*`. Modelled as a
    // single token so that intra-fragment adjacency (no whitespace around the
    // hyphens) is enforced lexically, mirroring the reference parser; the `/`
    // separators between fragments stay whitespace-permissive at grammar level.
    import_fragment: ($) =>
      token(/[a-zA-Z_][a-zA-Z0-9_]*(-(0|[1-9][0-9]*)?[a-zA-Z_][a-zA-Z0-9_]*)*/),

    // A binding's value is always a reservation context: the `;` that may
    // follow it closes the binding (inline `let`) or is an error (module-level
    // declaration) — it is never the binding's own discard operator.
    let_binding: ($) =>
      seq("let", field("name", $.identifier), optional(seq(":", field("type", $._type_expression))), "=", field("value", $._reserved_core_expression)),

    export_statement: ($) => seq("export", $.let_binding),

    type_declaration: ($) =>
      seq(
        "type",
        field("name", $.identifier),
        optional($.type_parameters),
        field("type", $._type_expression),
      ),

    export_type_declaration: ($) => seq("export", $.type_declaration),

    // ── Expressions ────────────────────────────────────────────
    //
    // The discard operator `;` evaluates both operands, drops the left one's
    // value and yields the right one's. It is the lowest precedence level and
    // right-associative, so `a; b; c` is `a; (b; c)`.
    //
    // Because every keyword-headed construct's trailing body is itself an
    // expression, the expression grammar comes in two flavors:
    //
    //   ordinary — `;` is the discard operator, and a trailing body extends
    //     through it: `if (c) A(); B()` puts `B()` inside the then-branch, and
    //     `fn(n: Int) n; n * 2` is one function whose body is the chain.
    //
    //   reserved — an unparenthesised `;` belongs to an enclosing construct, so
    //     no body may consume it. The two reservation contexts are a `let`
    //     binding's value, whose `;` closes the binding, and module-statement
    //     level, which has no terminator at all. The reservation propagates
    //     down the rightward spine — the trailing bodies of `if`, `fn`,
    //     `raise`, `try`, `switch`, `with` and of a nested `let` — so a nested body
    //     cannot eat the `;` its enclosing binding requires. That is what keeps
    //     `let x = if (c) v else raise E("…"); rest` parsing as a binding
    //     followed by `rest`, and what makes a stray `;` at module level an
    //     error rather than a silent glue between two statements.
    //
    // Ownership is inside-out: each unparenthesised `;` on a reserved spine is
    // claimed by the innermost construct still awaiting a required separator of
    // its own (a `let` awaiting its `;`), and the first one nothing claims ends
    // the reserved region. Bracketing delimiters — parentheses, brackets,
    // argument lists, indices, interpolations, collection members, the
    // parenthesised `if` condition and `with` subject — reset to the ordinary
    // flavor, so
    // `let x = (A(); B()); rest` and `f(a; b)` chain anywhere. Positions bounded
    // only by a keyword (a then-branch before `else`, a non-final `case` arm, a
    // `try` body before `catch`) stay reserved; parenthesise to chain there.
    //
    // Both flavors are generated from one description by `expressionFlavor()`
    // below. Each reserved twin is a hidden rule aliased back to its ordinary
    // node name, so highlighting, indentation and textobject queries see a
    // single node type either way.

    _expression: ($) => choice($.discard_expression, $._core_expression),

    discard_expression: ($) =>
      prec.right(PREC.DISCARD, seq(
        field("left", $._core_expression),
        ";",
        field("right", $._expression),
      )),

    ...expressionFlavor(false),
    ...expressionFlavor(true),

    fn_parameters: ($) => commaSep1($.fn_parameter),

    // A parameter's type annotation is optional: an untyped parameter is legal
    // wherever an expectation supplies its type, as in `fn(x) x + 1` checked
    // against `fn(Int) Int`.
    fn_parameter: ($) =>
      seq(field("name", $.identifier), optional(seq(":", field("type", $._type_expression)))),

    extern_expression: ($) =>
      seq("extern", field("name", $.string), ":", field("type", $._type_expression)),

    // The v1 pattern set: a variant pattern `.name(<pat>, …)`, a `nil` pattern,
    // a wildcard `_`, and a variable binding. Deferred forms (literals, ranges,
    // list/cons, @-bindings, guards) are rejected by the reference parser and
    // are not modelled here.
    _pattern: ($) =>
      choice(
        $.variant_pattern,
        $.nil_pattern,
        $.wildcard_pattern,
        $.binding_pattern,
      ),

    // A variant pattern `.name` or `.name(<pat>, …)`. The payload pattern list
    // binds to the label in the pattern production, exactly as a tagged atom's
    // payload binds in the atom production.
    variant_pattern: ($) =>
      seq(".", field("label", $.identifier), optional($.pattern_payload)),

    pattern_payload: ($) => seq("(", commaSep1($._pattern), ")"),

    wildcard_pattern: ($) => "_",

    nil_pattern: ($) => "nil",

    binding_pattern: ($) => field("name", $.identifier),

    // A catch target is an identifier optionally qualified by dotted property
    // accesses (e.g. `Option.UnexpectedNil`) — not a general expression.
    _catch_target: ($) =>
      choice(
        $.identifier,
        alias($.catch_target_access, $.property_access),
      ),

    catch_target_access: ($) =>
      seq(
        field("object", $._catch_target),
        ".",
        field("property", $.identifier),
      ),

    exception_expression: ($) =>
      prec(1, choice(
        seq("exception", "(", $._type_expression, ")"),
        prec(-1, "exception"),
      )),

    // ── Atom expressions ───────────────────────────────────────

    _atom_expression: ($) =>
      choice(
        $.parenthesized_expression,
        $.string,
        $.dict,
        $.record,
        $.list,
        $.float,
        $.integer,
        $.boolean,
        $.nil,
        $.atom,
        $.exception_expression,
        $.path_expression,
        $.identifier,
      ),

    // An atom literal `.name`, optionally carrying a positional payload
    // `.name(e1, …, en)` (a tagged atom). Property access wins where a leading
    // dot is ambiguous, so an atom is recognised only at the head of a primary
    // expression; after a preceding expression the `.name` is a
    // `property_access` instead. The payload arg list binds to the label in the
    // atom production (not as a call on the atom, which is not callable), so it
    // takes precedence over reading `.name` as a call target.
    atom: ($) =>
      prec.right(PREC.POSTFIX + 1, seq(".", field("label", $.identifier), optional($.atom_payload))),

    atom_payload: ($) => seq("(", commaSep1($._expression), ")"),

    parenthesized_expression: ($) => seq("(", $._expression, ")"),

    path_expression: ($) => {
      const segment = choice(/[\w.@-]+/, seq('"', /[^"]*/, '"'));
      const link = seq("/", segment, repeat(segment));
      return choice(
        // Relative paths: unambiguous, single token
        token(choice(
          seq("..", repeat1(link)),
          seq(".", repeat1(link)),
          "..",
        )),
        // Absolute paths: grammar-level, disambiguated by parser context
        // token.immediate ensures the segment is directly after `/` (no space)
        prec.right(-1, seq("/", $._path_segment, repeat(seq("/", $._path_segment)))),
        // Standalone root path
        prec(-2, "/"),
      );
    },

    _path_segment: ($) =>
      token.immediate(/[\w.@-]+/),

    // ── Collections ────────────────────────────────────────────

    record: ($) =>
      choice(
        seq("{", "}"),
        seq("{", commaSep1($.record_field), "}"),
      ),

    record_field: ($) =>
      choice(
        seq(field("name", $.identifier), ":", field("value", $._expression)),
        field("name", $.identifier),
      ),

    dict: ($) =>
      choice(
        seq("#", "{", "}"),
        seq("#", "{", commaSep1($._dict_item), "}"),
      ),

    // A dict item mirrors a list item: an entry, a spread, or one of the
    // comprehension forms wrapped around another item.
    //
    // Unlike `_list_item`, this needs no conflict with `if_expression` and no
    // dynamic precedence to prefer the item reading. An item ending in an
    // entry ends in `key: value`, so the two readings of `#{if (c) "k": v}` —
    // a guarded entry, or an entry keyed by the else-less `if` expression
    // `if (c) "k"` — are told apart by the `:`: `if_expression`'s right
    // associativity shifts it into the entry that is the guard's body. An
    // `else` instead keeps the `if` an expression, since a guarded item has no
    // `else`, so `#{if (c) "a" else "b": 1}` is an entry with an
    // `if`-expression key. An item ending in a spread never enters the
    // ambiguity: the `in` after `#{if (c)` can only open a spread body, since
    // `in` can never begin an expression.
    _dict_item: ($) =>
      choice(
        $.dict_for_item,
        $.dict_if_item,
        $.dict_spread_item,
        $.dict_entry,
      ),

    dict_for_item: ($) =>
      seq(
        "for",
        "(",
        field("variable", $.identifier),
        "in",
        field("iterable", $._expression),
        ")",
        field("body", $._dict_item),
      ),

    dict_if_item: ($) =>
      seq(
        "if",
        "(",
        field("condition", $._expression),
        ")",
        field("body", $._dict_item),
      ),

    // A spread item `in e` splices the operand collection's contents at its
    // position. Unambiguous with zero lookahead, as in the reference parser:
    // `in` can never begin an expression — a key expression included — so an
    // item-initial `in` is always a spread.
    dict_spread_item: ($) =>
      seq("in", field("operand", $._expression)),

    dict_entry: ($) =>
      seq(field("key", $._expression), ":", field("value", $._expression)),

    list: ($) =>
      choice(
        seq("[", "]"),
        seq("[", commaSep1($._list_item), "]"),
      ),

    _list_item: ($) =>
      choice(
        $.list_for_item,
        $.list_if_item,
        $.list_spread_item,
        $._expression,
      ),

    list_for_item: ($) =>
      prec.dynamic(1, seq(
        "for",
        "(",
        field("variable", $.identifier),
        "in",
        field("iterable", $._expression),
        ")",
        field("body", $._list_item),
      )),

    list_if_item: ($) =>
      prec.dynamic(1, seq(
        "if",
        "(",
        field("condition", $._expression),
        ")",
        field("body", $._list_item),
      )),

    // A spread item `in e` splices the operand list's elements at its
    // position. It needs neither the `if_expression` conflict nor a dynamic
    // precedence: `in` can never begin an expression, so an item-initial `in`
    // is always a spread — with zero lookahead, as in the reference parser —
    // and an `in` after `[if (c)` can only open a spread body, never an `if`
    // expression's consequence.
    list_spread_item: ($) =>
      seq("in", field("operand", $._expression)),

    // ── Type expressions ───────────────────────────────────────

    _type_expression: ($) =>
      choice(
        $.optional_type,
        $._type_expression_base,
      ),

    optional_type: ($) =>
      prec(1, seq($._type_expression_base, "?")),

    _type_expression_base: ($) =>
      choice(
        $.fn_type,
        $.dict_type,
        $.record_type,
        $.enum_type,
        $.list_type,
        $.type_application,
        $.type_property_access,
        alias($.identifier, $.type_identifier),
      ),

    // An enum type `enum { .a, .b }`: the `enum` keyword and a brace-delimited,
    // comma-separated list of `.variant` labels (trailing comma allowed). A
    // variant may carry a positional payload type list, `.tag(T1, …, Tk)`.
    enum_type: ($) => seq("enum", "{", commaSep1($.enum_variant), "}"),

    enum_variant: ($) =>
      seq(".", field("label", $.identifier), optional($.enum_variant_payload)),

    enum_variant_payload: ($) => seq("(", commaSep1($._type_expression), ")"),

    list_type: ($) => seq("[", $._type_expression, "]"),

    fn_type: ($) =>
      prec.right(seq(
        "fn",
        optional($.type_parameters),
        "(",
        optional(commaSep1($._type_expression)),
        ")",
        field("return_type", $._type_expression),
      )),

    record_type: ($) =>
      choice(
        seq("{", "}"),
        seq("{", commaSep1($.record_type_field), "}"),
      ),

    record_type_field: ($) =>
      seq(field("name", $.identifier), ":", field("type", $._type_expression)),

    dict_type: ($) =>
      seq("#", "{", field("key", $._type_expression), ":", field("value", $._type_expression), "}"),

    type_property_access: ($) =>
      prec.left(2, seq($._type_expression_base, ".", alias($.identifier, $.type_identifier))),

    // Instantiating a generic type, `Foo<A, B>`. Like `type_property_access` it
    // is a suffix on a base type, so the two chain in either order and in any
    // number: `Std.Map<K, V>.Entry`.
    type_application: ($) =>
      prec.left(2, seq(field("base", $._type_expression_base), $.type_arguments)),

    // ── Generics ───────────────────────────────────────────────

    type_parameters: ($) =>
      seq("<", commaSep1($.type_parameter), ">"),

    type_parameter: ($) =>
      choice(
        seq(field("name", $.identifier), "<:", field("bound", $._type_expression)),
        field("name", $.identifier),
      ),

    type_arguments: ($) =>
      seq("<", commaSep1($._type_expression), ">"),

    // ── Strings ────────────────────────────────────────────────

    string: ($) =>
      seq(
        '"',
        repeat(choice($.string_content, $.interpolation)),
        '"',
      ),

    interpolation: ($) =>
      seq("{", $._expression, "}"),

    // ── Literals ───────────────────────────────────────────────

    identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    integer: ($) => token(choice("0", /[1-9][0-9]*/)),

    float: ($) =>
      token(seq(choice("0", /[1-9][0-9]*/), ".", /[0-9]+/)),

    boolean: ($) => choice("true", "false"),

    nil: ($) => "nil",

    comment: ($) => token(seq("//", /.*/)),
  },
});

/**
 * Comma-separated list with optional trailing comma.
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(",", rule)), optional(","));
}

/**
 * The rule name a flavored rule is defined under.
 */
function flavorName(base, reserved) {
  return reserved ? `_reserved_${base.replace(/^_/, "")}` : base;
}

/**
 * The raw symbol of a rule in the given flavor, un-aliased — for `conflicts`,
 * which names rules rather than nodes.
 */
function flavorSymbol($, base, reserved) {
  return $[FLAVORED.includes(base) ? flavorName(base, reserved) : base];
}

/**
 * A conflict declared once per flavor.
 */
function bothFlavors($, bases) {
  return [false, true].map((reserved) =>
    bases.map((base) => flavorSymbol($, base, reserved)),
  );
}

/**
 * One flavor of the expression grammar — see the "Expressions" comment above.
 * The two flavors differ only in what a trailing body may be, but a body sits
 * at the far end of a rightward spine, so every rule along that spine needs a
 * twin. Everything the spine reaches through a bracket (atoms, collections,
 * strings, patterns, types) is shared, and resets to the ordinary flavor.
 *
 * The flavors must stay disjoint: no state may predict both, or the two
 * `_core_expression` rules become ambiguous. That holds because every reserved
 * rule starts with either a keyword token or the reserved core itself.
 */
function expressionFlavor(reserved) {
  const name = (base) => flavorName(base, reserved);
  // A reference to a flavored rule, aliased back to its ordinary node name so
  // the tree exposes one node type in either flavor.
  const ref = ($, base) => {
    const symbol = flavorSymbol($, base, reserved);
    return reserved && !base.startsWith("_") ? alias(symbol, $[base]) : symbol;
  };
  // An operand of an operator: never a discard chain, in either flavor.
  const operand = ($) => flavorSymbol($, "_core_expression", reserved);
  // A trailing body: it inherits the current flavor.
  const body = ($) => (reserved ? $._reserved_core_expression : $._expression);

  return {
    [name("_core_expression")]: ($) =>
      choice(
        ref($, "if_expression"),
        ref($, "let_expression"),
        ref($, "fn_expression"),
        $.extern_expression,
        ref($, "raise_expression"),
        ref($, "try_expression"),
        ref($, "switch_expression"),
        ref($, "with_expression"),
        ref($, "binary_expression"),
        ref($, "unary_expression"),
        ref($, "type_cast"),
        ref($, "call_expression"),
        ref($, "property_access"),
        ref($, "indexed_access"),
        $._atom_expression,
      ),

    [name("binary_expression")]: ($) =>
      choice(
        prec.left(PREC.OR, seq(field("left", operand($)), field("operator", "||"), field("right", operand($)))),
        prec.left(PREC.NIL_COALESCE, seq(field("left", operand($)), field("operator", "??"), field("right", operand($)))),
        prec.left(PREC.AND, seq(field("left", operand($)), field("operator", "&&"), field("right", operand($)))),
        prec.left(PREC.EQUALITY, seq(field("left", operand($)), field("operator", "=="), field("right", operand($)))),
        prec.left(PREC.EQUALITY, seq(field("left", operand($)), field("operator", "!="), field("right", operand($)))),
        prec.left(PREC.COMPARISON, seq(field("left", operand($)), field("operator", "<"), field("right", operand($)))),
        prec.left(PREC.COMPARISON, seq(field("left", operand($)), field("operator", "<="), field("right", operand($)))),
        prec.left(PREC.COMPARISON, seq(field("left", operand($)), field("operator", ">"), field("right", operand($)))),
        prec.left(PREC.COMPARISON, seq(field("left", operand($)), field("operator", ">="), field("right", operand($)))),
        prec.left(PREC.ADDITIVE, seq(field("left", operand($)), field("operator", "+"), field("right", operand($)))),
        prec.left(PREC.ADDITIVE, seq(field("left", operand($)), field("operator", "-"), field("right", operand($)))),
        prec.left(PREC.MULTIPLICATIVE, seq(field("left", operand($)), field("operator", "*"), field("right", operand($)))),
        prec.left(PREC.MULTIPLICATIVE, seq(field("left", operand($)), field("operator", "/"), field("right", operand($)))),
      ),

    [name("unary_expression")]: ($) =>
      prec(PREC.UNARY, seq(field("operator", choice("-", "!")), field("operand", operand($)))),

    [name("type_cast")]: ($) =>
      prec.left(PREC.POSTFIX, seq(
        field("expression", operand($)),
        "as",
        field("type", $._type_expression),
      )),

    [name("property_access")]: ($) =>
      prec.left(PREC.POSTFIX, seq(
        field("object", operand($)),
        ".",
        field("property", $.identifier),
      )),

    [name("call_expression")]: ($) =>
      prec.left(PREC.POSTFIX, seq(
        field("function", operand($)),
        optional($.type_arguments),
        "(",
        optional(commaSep1($._expression)),
        ")",
      )),

    // Subscript / indexing: `expr[index]`. The opening bracket is matched with
    // `token.immediate` so it only attaches when it directly follows the
    // preceding expression with no intervening whitespace — this disambiguates
    // a subscript from a fresh list literal in statement position (mirroring
    // the reference parser's adjacency requirement).
    [name("indexed_access")]: ($) =>
      prec.left(PREC.POSTFIX, seq(
        field("object", operand($)),
        token.immediate("["),
        field("index", $._expression),
        "]",
      )),

    [name("if_expression")]: ($) =>
      prec.right(seq(
        "if",
        "(",
        field("condition", $._expression),
        ")",
        field("consequence", body($)),
        optional(seq("else", field("alternative", body($)))),
      )),

    [name("let_expression")]: ($) =>
      seq($.let_binding, ";", field("body", body($))),

    [name("fn_expression")]: ($) =>
      prec.right(seq(
        "fn",
        optional($.type_parameters),
        "(",
        optional($.fn_parameters),
        ")",
        field("body", body($)),
      )),

    [name("raise_expression")]: ($) =>
      prec.right(seq("raise", field("value", body($)))),

    [name("try_expression")]: ($) =>
      prec.right(seq(
        "try",
        field("body", body($)),
        repeat1(ref($, "catch_clause")),
      )),

    [name("catch_clause")]: ($) =>
      choice(
        seq(
          "catch",
          field("exception", $._catch_target),
          "(",
          field("binding", $.identifier),
          ")",
          ":",
          field("body", body($)),
        ),
        seq(
          "catch",
          field("exception", $._catch_target),
          ":",
          field("body", body($)),
        ),
      ),

    // A `switch` pairs a subject expression with zero or more `case` clauses.
    // The subject expression extends rightward until the first `case` keyword;
    // zero clauses is legal (its validity is a coverage question). Mirrors the
    // right-associative shape of `try`/`catch`.
    [name("switch_expression")]: ($) =>
      prec.right(seq(
        "switch",
        field("subject", body($)),
        repeat(ref($, "case_clause")),
      )),

    [name("case_clause")]: ($) =>
      seq(
        "case",
        field("pattern", $._pattern),
        ":",
        field("body", body($)),
      ),

    // A `with` gates its trailing body on the parenthesised subject's
    // existence. The subject sits in the construct's own parentheses — a
    // bracketing delimiter, so it resets to the ordinary flavor — while the
    // body extends rightward and inherits the current flavor, exactly like an
    // `if` branch.
    [name("with_expression")]: ($) =>
      prec.right(seq(
        "with",
        "(",
        field("subject", $._expression),
        ")",
        field("body", body($)),
      )),
  };
}
