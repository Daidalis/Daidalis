/* tslint:disable */
/* eslint-disable */

/**
 * An opaque handle to one element of a session's resolved model.
 */
export class Element {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
}

/**
 * The push-driven language server (`sysmlv2-lsp`, browser transport):
 * feed one client→server LSP JSON-RPC message, get the server→client
 * messages it produced. A tiny worker shim on the JS side is the
 * transport: `postMessage` objects in, `handle` strings through,
 * `postMessage` objects out. Serves the syntax tier (diagnostics,
 * symbols, semantic tokens, formatting, navigation over open
 * documents); workspace/library-aware semantics stay with [`Session`]
 * and [`check`] — the kernel's job.
 */
export class LspServer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Handle one JSON-RPC message string; returns produced messages.
     */
    handle(msg: string): string[];
    /**
     * Drop cached navigation sessions after a host-side engine
     * reconfiguration (e.g. [`set_unit_spelling_expansion`]) that
     * changes answers without any source changing. Returns the
     * refresh requests to relay, like `setWorkspace`.
     */
    invalidateSessions(): string[];
    /**
     * The syntax-tier-only server (no standard library).
     * NOTE: a fallible `#[wasm_bindgen(constructor)]` (Result return)
     * leaves the JS object with a null pointer — keep the constructor
     * infallible and use [`Self::with_library`] for the library shape.
     */
    constructor();
    /**
     * Set whether evaluated-value inlay hints that restate the
     * declared expression verbatim are suppressed (default on).
     * Returns the refresh requests to relay, like
     * `setWorkspace`.
     */
    setHideRedundantValueHints(on: boolean): string[];
    /**
     * Set whether accepting a unit completion inside an untyped
     * attribute's quantity bracket also declares the type the unit
     * determines (default on). Takes effect on the next completion
     * request.
     */
    setInferUnitTypes(on: boolean): void;
    /**
     * Set how evaluated-value inlay hints, hover values and range hints
     * write a rational without a terminating decimal expansion. `spec`
     * is a style — `exact` (`1/15`, the default), `approx`
     * (`≈0.06666666666666667`), `overline` (`0.06̅`), `parens` (`0.0(6)`) or
     * `unicode` (`¹/₁₅`) — then optional comma-separated settings:
     * `digits=N` (significant digits of an approximate decimal, every
     * style's fallback; 0 = shortest), `period=N` (`overline`,
     * `parens`: longest period written out, default 6), `mixed=bool`
     * (`exact`, `unicode`: `2 1/3`, `2¹/₃`), `slash=solidus|fraction|division`
     * and `glyphs=bool` (`unicode`), `fraction-digits=N` (`exact`,
     * `unicode`: most digits per numerator or denominator, 0 = no
     * limit). Throws on a spec it cannot read, naming the problem.
     * Returns the refresh requests to relay, like `setWorkspace`.
     */
    setNumberFormat(spec: string): string[];
    /**
     * Seed (or replace) the navigation workspace: every model unit the
     * host knows about, as JSON `[{name, text}]` where `name` is the
     * same uri string the client opens the document under. Open
     * documents overlay these, so definition/references/hover cross
     * into units that are not open.
     *
     * Returns server→client messages the re-seed produced — the
     * `workspace/inlayHint/refresh` / `workspace/codeLens/refresh`
     * requests that make supporting clients re-pull answers the old
     * session gave. Relay them exactly like [`Self::handle`] output. Only
     * a re-seed of the same units with the same texts, with no document
     * opened, changed or closed since refresh requests last went out,
     * returns none. A re-seed that changes only the texts of units open as
     * documents, whose open texts overlay them, keeps the server's
     * sessions, and the re-pull answers from them.
     */
    setWorkspace(sources_json: string): string[];
    /**
     * A server whose navigation and completions see the standard
     * library: sources as JSON `[{name, text}]`, optionally with the
     * sealed resolution snapshot recorded against the same units.
     */
    static withLibrary(lib_sources_json: string, lib_snapshot?: Uint8Array | null): LspServer;
    /**
     * A server whose navigation and completions see a prepared library.
     * The library was resolved when it was prepared, so a session resolves
     * the workspace's units against it rather than the library's sources;
     * a workspace that may change what the library's own names resolve to
     * (for example a root name the library looked up and missed, or a root
     * declaration named like one of the library's) has the library resolved
     * again with it. The server keeps its own reference; the handle may be
     * freed afterwards. A handle decoded with `keepHostParts: true`
     * (`PreparedLibrary.fromSnapshot`, `fromSnapshotStream`) gives the
     * server the library symbol table its snapshot carries, which it builds
     * its table from on its first completion or import fix instead of
     * parsing every library unit; on any other handle it parses them, as
     * before, and answers the same.
     */
    static withPreparedLibrary(library: PreparedLibrary): LspServer;
}

/**
 * An immutable library graph reusable across session builds and edits.
 * Prepare the final ordered source bundle once. Changed sources require a new
 * handle. Sessions retain the library independently of this handle's lifetime.
 */
export class PreparedLibrary {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * [`Self::from_snapshot`] reading the snapshot where it lies: `view` stays
     * in the host's memory and is copied into this module one window at a
     * time, so the module's memory never holds the whole snapshot (which it
     * would keep as its high-water mark). Same refusals as `fromSnapshot`.
     * The snapshot also carries the language server's library symbol table:
     * with `keepHostParts: true` the handle keeps it for a server on it
     * (`LspServer.withPreparedLibrary`) to build its table from; by default
     * it passes through, verified, and a module that hosts no language
     * server holds none of it.
     */
    static fromSnapshotStream(view: Uint8Array, sources_json: string, recording?: Uint8Array | null, keepHostParts?: boolean | null): PreparedLibrary;
    /**
     * Decode a prepared snapshot (the package's `sysml-library.prepared.gz`,
     * decompressed) of exactly `sources_json`, the bundle it was generated
     * from: no resolve at boot, no syntax trees in memory. A snapshot made by
     * another build or from other units is refused with an error, and the
     * caller prepares from source with `new` instead. `recording` is the
     * sealed resolution snapshot, kept encoded for the builds that must
     * resolve the library together with user units. The snapshot also
     * carries the language server's library symbol table: with
     * `keepHostParts: true` the handle keeps it for a server on it
     * (`LspServer.withPreparedLibrary`) to build its table from; by default
     * it is verified and dropped, and a module that hosts no language
     * server holds none of it.
     */
    static fromSnapshot(snapshot: Uint8Array, sources_json: string, recording?: Uint8Array | null, keepHostParts?: boolean | null): PreparedLibrary;
    /**
     * Prepare library sources (JSON `[{name, text}]`) with an optional sealed
     * resolution snapshot. Stale or corrupt snapshots fall back to source.
     */
    constructor(sources_json: string, snapshot?: Uint8Array | null);
}

/**
 * A set of model sources (text or interchange JSON) with their resolved
 * model — `sysmlv2_transform::Session` behind a JS-shaped API.
 */
export class Session {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Explicit `about` targets of an annotating element, resolved.
     */
    annotatedElements(e: Element): Element[];
    /**
     * [`Self::apply_delta_cbor_to`] with the applied result embedded
     * as a raw JSON **string** field (`resultJson`) instead of a
     * parsed value: host-language JSON parsers may re-canonicalize
     * numbers (`1.0` → `1`), which changes the compact-CBOR encoding
     * and therefore the state digest — a digest-faithful replay chain
     * must carry state documents as emitted strings end to end.
     */
    applyDeltaCborToRaw(bytes: Uint8Array, base_json: string, lenient: boolean): string;
    /**
     * Apply a delta payload against a caller-held base document (a
     * compact element array as JSON) instead of the session's own
     * model — the payload-file base path: a file base's identity is
     * the file's content, and lifting it into a session would
     * re-derive ids and change the digest a strict delta gates on.
     * The session provides the library context for elided created
     * ids; result shape as [`Self::apply_delta_cbor`].
     */
    applyDeltaCborTo(bytes: Uint8Array, base_json: string, lenient: boolean): string;
    /**
     * Apply a delta payload against the session's model. Returns JSON
     * `{ "result": [...], "report": { "baseMatched", "noopDeletes",
     * "upsertedUpdates", "replacedCreates" } }`; the session itself is
     * unchanged — the host decides what to do with the result. Strict
     * application refuses a wrong base; `lenient` applies portable
     * deltas best-effort with the report saying what happened.
     */
    applyDeltaCbor(bytes: Uint8Array, lenient: boolean): string;
    /**
     * Dry-run an edit batch (same ops JSON as [`Self::edit`]): the full
     * verified-commit pipeline — splice, reparse, rebuild, reference
     * checks — runs against copies and the session is untouched either
     * way (no rebuild, handles stay valid). Returns `{wouldCommit:
     * true, idMap, findings, splices}` — exactly what `edit` would
     * report — or `{wouldCommit: false, refusal}` with the exact
     * refusal it would roll back with (unresolvable op targets
     * included). Errors only for malformed ops JSON.
     */
    checkEdit(ops_json: string): string;
    /**
     * The session's check findings — the same JSON the free [`check`]
     * returns for the session's sources and library, read off this
     * session's build instead of a second one (no parse-stage entries:
     * the session holds only units that parsed; without a library the
     * resolution stages are skipped, as `check` skips them). A host
     * that partitions its units by [`check_syntax`] and opens a
     * session over the ones that parsed gets every stage with one
     * resolution.
     */
    check(): string;
    /**
     * The closure policy `derived` answers under: `"passthrough"` (the
     * default), `"closure"` or `"closure-implied"`.
     */
    closurePolicy(): string;
    /**
     * Every derived property name `derived` can answer on some
     * metaclass.
     */
    static computedNames(): string[];
    /**
     * Reachability including supported implied library and variation bases.
     * A negative result does not establish complete non-conformance.
     */
    conformsWithImplied(e: Element, ancestor: Element): boolean;
    /**
     * Does `e` reach `ancestor` through the explicit specialization
     * closure?
     */
    conforms(e: Element, ancestor: Element): boolean;
    declarationSite(e: Element): string | undefined;
    /**
     * Decode any snapshot-form s2c payload (compact, id-elided, or
     * full) to its element array as JSON text, naming elided targets
     * through the session's library. Delta payloads refuse with their
     * pointed message — apply those with [`Self::apply_delta_cbor`].
     */
    decodeCbor(bytes: Uint8Array): string;
    /**
     * Encode the delta from `base_json` (a compact element array) to
     * this session's model as an s2c delta payload. `portable`
     * selects id-keyed identities for best-effort application to
     * divergent bases; the strict default is smaller and digest-gated.
     */
    deltaCborFrom(base_json: string, portable: boolean): Uint8Array;
    /**
     * The element handles of the derived property `name` of `e`: the
     * element of a single-valued value, the elements of a list, the
     * in-model targets of a reference-typed value — a target outside the
     * model has no handle and is *dropped* here (it is in
     * [`Self::derived`]'s JSON as an `outside` object); empty for a
     * string or boolean. Errors as `derived` does.
     */
    derivedElements(e: Element, name: string): Element[];
    /**
     * The derived property `name` of `e`, by its specification name
     * (`"ownedFeature"`, `"owningNamespace"`, `"name"`, …), as JSON: `null`
     * for a null single value, a boolean or string, an array of strings,
     * an element as `{"@id": …}` and a list of elements as an array of
     * them; a target outside the model as `{"outside": true, "id"?: …,
     * "spelling"?: …}` (an element of an unloaded library or a foreign
     * payload by its id, or a reference that never resolved by its
     * spelling). Element handles for the same value come from
     * [`Self::derived_elements`]. Errors when the element's metaclass
     * does not declare the property as derived or the toolkit does not
     * compute it yet; `derives` tells in advance.
     */
    derived(e: Element, name: string): string;
    /**
     * What `derived` answers for `name` on elements of `metaclass`,
     * decided without a model: `"not-declared"`, `"not-computed"`,
     * `"passthrough"` or `"exact"`.
     */
    static derives(metaclass: string, name: string): string;
    /**
     * The element's documentation/comment bodies, display-normalized,
     * in declaration order: `doc` members annotating it plus comments
     * naming it in `about`.
     */
    docs(e: Element): string[];
    /**
     * Apply an edit batch (JSON array of `EditOpIn` operations) via
     * the session's edit engine: splices are planned at
     * resolver-recorded spans, applied, reparsed, and verified for
     * semantic identity — or rolled back, in which case this returns
     * the engine's error and the session is unchanged.
     *
     * On success the session is rebuilt (outstanding handles go stale)
     * and the result JSON reports what happened: `{idMap: [[oldId,
     * newId]…], findings: [string…], splices: [{unit, start, end,
     * text}…]}` — splices in pre-commit byte offsets per unit, exactly
     * what an editor mirror needs to replay the change.
     *
     * A `rename` whose new name a sibling in the same owner already
     * carries (or that another rename in the batch gives a sibling)
     * is dropped rather than refusing the batch: the rest commits and
     * each dropped rename is one `findings` line. A batch of nothing
     * but dropped renames commits nothing and leaves handles valid.
     */
    edit(ops_json: string): string;
    /**
     * Look up an interchange UUID, including unnamed and library elements.
     * Returns no handle for malformed or absent IDs. Like name-resolved
     * handles, the result goes stale when the session is rebuilt.
     */
    elementById(id: string): Element | undefined;
    /**
     * The element's interchange `@id`.
     */
    elementId(e: Element): string;
    /**
     * Every element of the given metaclass.
     */
    elementsOfMetaclass(ty: string): Element[];
    /**
     * Evaluate `e`'s bound feature value; JSON, as in [`Self::query`].
     */
    evaluate(e: Element): string;
    /**
     * Members owned via FeatureMembership kinds (KerML `ownedFeature`).
     */
    features(e: Element): Element[];
    /**
     * Open compact CBOR against a shared prepared library.
     */
    static fromCompactCborWithPreparedLibrary(bytes: Uint8Array, library: PreparedLibrary, indent?: string | null): Session;
    /**
     * Open a session over a compact-form CBOR payload (a `Uint8Array`)
     * — the binary counterpart of [`Self::from_interchange_json`];
     * library and indent arguments as there.
     */
    static fromCompactCbor(bytes: Uint8Array, lib_sources_json?: string | null, lib_snapshot?: Uint8Array | null, indent?: string | null): Session;
    /**
     * Open interchange JSON against a shared prepared library.
     */
    static fromInterchangeJsonWithPreparedLibrary(json: string, library: PreparedLibrary, indent?: string | null): Session;
    /**
     * Open a session over an interchange JSON document (compact or full
     * form; Flexo `{payload, identity}` wrapping accepted). Pass
     * standard-library sources (JSON `[{name, text}]`) to name library
     * element ids during the lift and keep the library loaded for
     * resolution — a library-typed payload generally needs it. An
     * optional sealed resolution snapshot (`LibraryCache::to_bytes`,
     * recorded against the same library sources in the same order —
     * the stdlib bundle ships one) makes library resolution
     * replay instead of search; stale bytes are rejected and the build
     * falls back to a cold resolve.
     * The optional `indent` names the indentation style for the
     * lifted unit text: `"tabs"`, or a space count like `"4"`
     * (default four spaces; presentation only, never identity).
     */
    static fromInterchangeJson(json: string, lib_sources_json?: string | null, lib_snapshot?: Uint8Array | null, indent?: string | null): Session;
    /**
     * [`Self::from_sources_with_prepared_library`] with resolution started
     * from `settled`, the outcomes a previous session settled on
     * ([`Self::settled_outcomes`]): a reference lowered where and as it
     * was takes its outcome, so a unit that resolves as it did is
     * confirmed in one pass, while an edited reference, and every
     * reference after an inserted or removed element, starts unresolved
     * and is carried through as many passes as it takes. What a host that
     * rebuilds its session after every edit starts the next build from;
     * the session answers as one built without.
     */
    static fromSourcesSettled(sources_json: string, library: PreparedLibrary, settled: SettledOutcomes): Session;
    /**
     * [`Self::from_sources`] resolved against standard-library sources
     * (JSON `[{name, text}]`, optional sealed snapshot — see
     * [`Self::from_interchange_json`]) in the same build. Opening a
     * session and then calling [`Self::load_library_sources`] resolves
     * the user units twice; this resolves them once.
     */
    static fromSourcesWithLibrary(sources_json: string, lib_sources_json?: string | null, lib_snapshot?: Uint8Array | null): Session;
    /**
     * Open sources against a shared prepared library in one model build.
     */
    static fromSourcesWithPreparedLibrary(sources_json: string, library: PreparedLibrary): Session;
    /**
     * Open a session over in-memory sources: JSON `[{name, text}]`.
     * Unit names ending in `.kerml` parse as KerML.
     */
    static fromSources(sources_json: string): Session;
    /**
     * The lint engine's validated generated-ownership join, exposed
     * directly to editor hosts. Unlike a host-side rescan this omits
     * every corrupt/ambiguous row (while `lint` reports why) and keeps
     * the guard contract in lockstep with sidecar ownership policy.
     */
    generatedInventory(): string;
    /**
     * Whether the element belongs to a loaded library.
     */
    isLibraryElement(e: Element): boolean;
    /**
     * Whether the abstract syntax owns `name` on `metaclass`.
     */
    static isOwnedProperty(metaclass: string, name: string): boolean;
    /**
     * Lint the session's user units the way `sysmlv2 lint` does:
     * configurable project-policy rules over the resolved
     * model — library and dependency elements are exempt by the
     * engine's closed-world discipline, so the caller owns dep-free
     * semantics exactly as with `verify`. `config_json` is the
     * `sysmlint.json` text (`{"rules": {"<id>": "off"|"hint"|"info"|"warn"|"error"
     * | {severity, …options}}}`); absent means every rule at its
     * default severity; unknown ids/options surface as `lint-config`
     * findings, and unreadable JSON is the only error. Returns
     * `{findings: [{stage, rule, severity, message, unit, unitName,
     * start, end, line, col, endLine, endCol, element, suggest, fix,
     * alternatives}], summary: {errors, warnings, infos, hints}}` (the
     * `sysmlv2_lint::json` report shape, shared with the CLI's
     * `--format json`; `stage` is always `lint` here) — byte offsets
     * and 1-based positions over the finding's name span; `unit` and
     * the positions are null on `lint-config` findings. `element`
     * (nullable) = the finding's edit-target spelling (`::`-qualified
     * name or `@<id>`) for host quick fixes;
     * `suggest` (nullable) = a naming finding's style-converted
     * replacement name. `fix` (nullable)
     * = `{label, deletes, semantic, edits: [{unit, unitName, start,
     * end, replacement}]}` with **byte** offsets over the unit's
     * current text (the splice currency every edit surface here uses);
     * `deletes` marks fixes hosts must gate behind explicit opt-in, and
     * `semantic` marks fixes that change what a declaration means
     * (never part of a fix-all sweep).
     * `alternatives` (array, same shape as `fix`) are equally-valid
     * remedies for a quick-fix menu — a dimensionally ambiguous unit
     * lists every compatible quantity type — never auto-applied.
     */
    lint(config_json?: string | null): string;
    /**
     * Resolve against standard-library sources (JSON `[{name, text}]`),
     * optionally with a sealed resolution snapshot (see
     * [`Self::from_interchange_json`]). Rebuilds the session:
     * outstanding handles go stale.
     */
    loadLibrarySources(sources_json: string, snapshot?: Uint8Array | null): void;
    /**
     * Attach a shared prepared library and rebuild; existing element handles
     * become stale, just as with `loadLibrarySources`.
     */
    loadPreparedLibrary(library: PreparedLibrary): void;
    /**
     * The element's recorded declaration site as JSON
     * `{"unit": index, "start": byte, "end": byte}` (the declaration
     * span, falling back to the full member extent), or undefined for
     * elements without one (library elements, synthesized members).
     * The unit index keys into `units()`; offsets are byte positions
     * into that unit's source — the caller owns line/column mapping.
     * The element's full member extent as JSON `{"unit": index,
     * "start": byte, "end": byte}` — the whole declaration including
     * its body, the range decorations and interception guards cover —
     * or undefined for elements without one.
     */
    memberExtent(e: Element): string | undefined;
    /**
     * The full source text of the member declaration that created the
     * element (target = `::`-qualified name or `@<interchange-id>`) —
     * what copy/paste carries between owners: feed it back through an
     * `insertMember` op. Errors for library elements and elements
     * without a recorded extent.
     */
    memberSource(target: string): string;
    /**
     * Owned members, in declaration order (KerML `ownedMember`).
     */
    members(e: Element): Element[];
    /**
     * The element's abstract-syntax metaclass (`PartUsage`, …).
     */
    metaclass(e: Element): string;
    /**
     * The shortest spelling of `target` that resolves to it from
     * inside `context`'s declaration — what a generated value
     * expression should write instead of the full qualified name
     * (same suffix discipline as minimize, without rewriting).
     */
    minimalSpelling(context: Element, target: Element): string | undefined;
    /**
     * Rewrite every plain reference site to the shortest suffix that
     * still resolves to the same element (reparse-verified; ids are
     * untouched by construction). Returns `{respelled, sites}`.
     * Element handles from before the call are invalidated — the
     * sources were rewritten and the model rebuilt.
     */
    minimizeQualifications(): string;
    /**
     * The element's declared name; the specification's `name` (an
     * unnamed feature named by what it redefines) is `derived(e, "name")`.
     */
    name(e: Element): string | undefined;
    /**
     * The model's outline tree and its named-element shape from one
     * walk, as JSON: what reading every element through `roots`,
     * `members`, `derived(e, "name")`, `name`, `qualifiedName`,
     * `metaclass` and `elementId` assembles, in one call and without a
     * handle per element.
     *
     * Options JSON (absent or empty = every default): `{outlineNodes?:
     * 4000, outlineDepth?: 24, shapeNodes?: 20000, shapeDepth?: 64}`.
     *
     * The walk visits `roots()` in order, each depth-first through its
     * `members` in declaration order. A root is at depth 0, and the walk
     * goes below an element at depth `d` only while `d < shapeDepth`.
     * Each visited element is named as `derived(e, "name")` names it
     * when that is a string, else by its declared name, else `null`.
     *
     * - **Outline.** Every visited element claims one of `outlineNodes`
     *   slots in visiting order (before its members); one visited after
     *   they are spent has no outline node. A node is `{name, metaclass,
     *   qualifiedName, children}` (`qualifiedName` `null` for an
     *   anonymous element), and a node at depth `d` keeps its members'
     *   nodes as `children` only while `d < outlineDepth`.
     * - **Shape.** An element whose name and qualified name are both
     *   non-empty is recorded as `{id, name, qualifiedName, metaclass,
     *   owner}`, in visiting order; `owner` indexes the nearest such
     *   ancestor in the list, `-1` for none (an anonymous element's
     *   members re-parent onto its nearest named ancestor). Once
     *   `shapeNodes` are recorded, every further named element is left
     *   out and sets `truncated`; so does an element at `shapeDepth`
     *   that has members.
     *
     * Reply: `{outline: [node…], shape: {nodes: [node…], truncated}}`.
     * Errors as `derived` does, or on malformed options.
     */
    outline(opts_json?: string | null): string;
    /**
     * The owning element (undefined for document roots).
     */
    owner(e: Element): Element | undefined;
    /**
     * Checked owned/derived property by specification name, encoded as JSON.
     */
    property(e: Element, name: string): string;
    /**
     * The element's qualified name (undefined for anonymous elements):
     * the specification's derivation, in which a reserved word used as
     * a name stays bare (`part::view`). A model property, not source
     * text — splice [`Self::reference_spelling`] into generated
     * `import`/`expose` targets instead.
     */
    qualifiedName(e: Element): string | undefined;
    /**
     * Evaluate an ad-hoc KerML query expression at the root namespace
     * (the `sysmlv2 query` semantics). Returns the value as JSON;
     * elements come back as `{"@element": id, "qualifiedName": …}`.
     */
    query(expr: string): string;
    /**
     * The links of the feature chain `e` redefines (`attribute :>>
     * chassis.mass`), first to last, resolved: the first such
     * redefinition's; empty when `e` redefines no chain.
     */
    redefinedChain(e: Element): Element[];
    /**
     * The feature `e` stands for through its redefinitions by name —
     * the end of `e` → its first redefinition target → … — or `e`
     * itself. Features that redefine one feature, however many steps
     * apart, share a root.
     */
    redefinitionRoot(e: Element): Element;
    /**
     * The element's qualified name spelled as reference text that
     * re-parses in either dialect: reserved words and non-basic names
     * quoted (`'part'::'view'` where `qualifiedName` reports
     * `part::view`). Undefined for anonymous elements.
     */
    referenceSpelling(e: Element): string | undefined;
    /**
     * Find usages: every reference that resolves to the element, with
     * the element's declaration — the language server's references
     * answer with the declaration included, positioned the same way.
     * The selector is a qualified name or `{elementId}`, as `revealPath`
     * takes it.
     *
     * JSON `{declaration: {unit, line, col, endLine, endCol, site} |
     * null, references: [{unit, line, col, endLine, endCol, kind,
     * owner}]}`. `unit` is the unit's name, as `check` findings carry
     * it; a library unit is `sysmlv2-lib:/` and its name percent-encoded
     * as a uri path, the uri the server gives it and a host serves the
     * library's text under. Lines and columns are 1-based, columns
     * counted in UTF-16 code units as an editor counts them, the end
     * exclusive.
     *
     * The declaration's `site` is `name` when its range is the declared
     * name, or `extent` when the element declares no name and the range
     * is its whole member declaration instead (a nameless redefinition,
     * `part :>> chassis { … }`, reached through a chain): somewhere to
     * open, not a range to rename at, and the server includes no
     * declaration then. The declaration is `null` for an element with
     * no recorded source.
     *
     * A reference's range covers the segment that names the element
     * (`Wheel` in `Defs::Wheel`). `kind` is the serialized property it
     * feeds (`type`, `superclassifier`, `importedMembership`, …).
     * `owner` is `{id, qualifiedName}` of the nearest enclosing element
     * that has a qualified name — `w` for `part w : Wheel;`, the package
     * an import sits in, the feature whose value names it, the first
     * named element around a reference written on something nameless —
     * or `null` when nothing around it has one, as at the top level of
     * a unit or inside a nameless element there. The sites come in unit
     * and position order. A library's own references are not recorded,
     * so a library element's sites are the model's references to it.
     *
     * Errors when the selector does not resolve. Reads only: nothing is
     * written into the model, and handles stay valid.
     */
    references(selector_json: string): string;
    /**
     * Resolve a `::`-qualified name to an element handle.
     */
    resolve(qualified_name: string): Element | undefined;
    /**
     * The containers from the scope root down to an element (root
     * first, the element's owner last), for opening a summary picture
     * onto it: JSON `[{id, qualifiedName}]`. The selector is a
     * qualified name or `{elementId}`; errors when it does not resolve.
     */
    revealPath(selector_json: string): string;
    /**
     * Top-level user elements: the owned members of each unit's root
     * namespace, in declaration order — the outline/tree entry point.
     * (Ownerless relationship records — memberships, typings, feature
     * values — are graph plumbing and never appear here.)
     */
    roots(): Element[];
    /**
     * Per-element reads for many elements in one call, as JSON.
     *
     * `ids_json` is an array of interchange ids and `fields_json` an
     * array of field names. The reply is an array in the order of the
     * ids: `null` where `elementById` finds no element, else an object
     * holding each field under its name, valued as the same-named
     * per-element read answers it — `undefined` as `null`, a JSON
     * answer decoded:
     *
     * - `name`, `shortName`, `qualifiedName`, `referenceSpelling`,
     *   `metaclass`, `isLibraryElement`, `valueSource`,
     *   `valueIsDefault`, `docs`, `declarationSite`, `memberExtent`;
     * - `owner`: the owner's id, or `null` for a document root;
     * - `property:<name>`: `property(e, name)`;
     * - `derived:<name>`: `derived(e, name)`.
     *
     * A read that errors leaves its field out and puts its message
     * under `errors: {field: message}` instead. Errors when either
     * array is malformed or names a field outside this list.
     */
    rows(ids_json: string, fields_json: string): string;
    /**
     * Set the closure policy (see `closurePolicy`).
     */
    setClosurePolicy(policy: string): void;
    /**
     * The outcomes this session's build settled on, for a session over
     * mostly the same units to start from ([`Self::from_sources_settled`]):
     * `undefined` unless the session was built on a prepared library and
     * its resolution ran more than one pass and settled — a build that
     * resolved in one pass, one that resolved the library together with
     * its units, or one that did not settle keeps none. A session rebuilt
     * by an edit or a library load keeps the outcomes of its latest build.
     */
    settledOutcomes(): SettledOutcomes | undefined;
    /**
     * The element's declared short name (`<shortName>`), when it has one;
     * the specification's `shortName` is `derived(e, "shortName")`.
     */
    shortName(e: Element): string | undefined;
    /**
     * Current text of a unit by model unit index (undefined for
     * library units).
     */
    source(unit: number): string | undefined;
    /**
     * The model's **state digest** — the content identity a delta
     * names its base by; emission-order-independent.
     */
    stateDigest(): string;
    /**
     * [`Self::to_compact_cbor`] with **id elision**: graph-derivable
     * ids are omitted and receivers recompute them, verified by the
     * payload digest. The session's library names the effective-name
     * targets; decode against the same library version.
     */
    toCompactCborElided(): Uint8Array;
    /**
     * Compact-form CBOR for the session's model (a `Uint8Array`) — the
     * deterministic binary re-encoding of [`Self::to_compact_json`],
     * several times smaller on the wire and decodable back to the
     * identical element array.
     */
    toCompactCbor(): Uint8Array;
    /**
     * Compact interchange JSON (KerML 10.4) for the session's model.
     */
    toCompactJson(): string;
    /**
     * Full-form CBOR (a `Uint8Array`) — the binary re-encoding of
     * [`Self::to_full_json`]. Emit view only; transport the compact
     * form and expand at the edge.
     */
    toFullCbor(recover_refs: boolean): Uint8Array;
    /**
     * Strict full JSON; no recovery elements or unavailable-value placeholders.
     */
    toFullJsonStrict(): string;
    /**
     * Full interchange JSON (derived properties + implied
     * relationships). With `recover_refs`, references that serialize as
     * dangling ids also carry their source spelling, so a partial model
     * survives emit → reload losslessly (the Flexo change-record path).
     */
    toFullJson(recover_refs: boolean): string;
    /**
     * Emit the structured diagram graph (nodes with element identity,
     * source spans, and compartment rows; edges with kinds) for a
     * view — the native renderer's input. Options as in
     * [`Self::to_plantuml`]; views without a graph emitter yet error.
     *
     * With `summary` (tree view only) the reply is the summary picture
     * and carries `summary: {resolved, unresolved}` — the open selectors
     * it resolved, as `{id, qualifiedName}`, and those it did not. With
     * `summary.fullWithin: n` as well, a scope whose summary would draw
     * at most `n` cards in full (its nodes plus every node's
     * `summary.hidden`) comes back as the full graph instead: the
     * request without `summary` would emit the same document, here with
     * `full: true` added and no `summary` field. One call then answers
     * what a summary request followed by a full request would.
     * `fullWithin` must be a finite number: `JSON.stringify` spells
     * `Infinity` and `NaN` as `null`, which reads as no `fullWithin`. A
     * host that wants the full graph whatever its size sends a large
     * finite number, or leaves `summary` out.
     */
    toGraph(opts_json?: string | null): string;
    /**
     * Emit a PlantUML diagram of the session's model. Options as
     * a JSON object (see `PlantumlOpts` docs); pass `undefined`/`"{}"`
     * for the defaults (tree view). Feed the text to any PlantUML build.
     */
    toPlantuml(opts_json?: string | null): string;
    /**
     * Explicit FeatureTyping targets (`: T`), resolved.
     */
    typings(e: Element): Element[];
    /**
     * The unit structure [`Self::to_compact_cbor`] carries, as JSON
     * `[[index, path], …]`: for each user unit, the compact element-array
     * index of its root namespace and the unit's source path — the
     * `units` that [`describe_cbor`] reports for that payload, read
     * without encoding it.
     */
    unitTable(): string;
    /**
     * The user units as JSON `[{unit, name, text}]` (`unit` is the
     * model unit index).
     */
    units(): string;
    /**
     * How many references failed to resolve.
     */
    unresolvedCount(): number;
    /**
     * Whether `e`'s own value is a default (`default v`) rather than a
     * binding (`= v`); undefined when `e` declares no value.
     */
    valueIsDefault(e: Element): boolean | undefined;
    /**
     * The source text of `e`'s bound value expression — the `<expr>`
     * in `= <expr>` — or undefined when the declaration carries no
     * value part (or the element has no user source). This is what a
     * value editor should prefill before the user rewrites it; feed
     * the replacement back through a `setFeatureValue` edit op, which
     * splices at the same recorded span.
     */
    valueSource(e: Element): string | undefined;
    /**
     * Verify constraints the way `sysmlv2 verify --ranges` does:
     * evaluate every non-library constraint, then narrow free
     * feature domains by joint interval propagation per unit — no
     * external solver. Options JSON: `{maxIters?, numberFormat?}`
     * (fixpoint pass cap per unit, default 100; the
     * [`setNumberFormat`](LspServer::set_number_format) spec `rangeApprox`
     * writes non-terminating endpoints in, default `"exact"`). Returns a JSON report: `{constraints:
     * [{unit, unitName, name, elementType, asserted, line, col,
     * endLine, endCol, status, method, detail, bindings, features}]
     * (`method` = which stage decided: evaluation|propagation, null
     * while undecided), ranges:
     * [{feature, unit, range, rangeApprox, narrowed}], summary: {satisfied,
     * violated, undecided}}` — positions 1-based over the result
     * expression; `status` folds definitive propagation conclusions
     * into satisfied|violated|undecided; `detail` is the human
     * verdict line, worded exactly like the CLI's (incl. the `(with
     * reserveKg = 0.10)` suffix on violated verdicts). `bindings` =
     * the result expression's feature references with their own
     * evaluations and declaration positions (`{feature, value?,
     * unitName?, line?, col?}`, empty for satisfied constraints);
     * `features` = the free features the propagation term references
     * (the keys into `ranges`). `satisfactions` holds one verdict per
     * `satisfy R by x;` claim, decided at the evaluation tier with R's
     * subjects bound to `x`: `{unit, unitName, requirement, by, negated,
     * line, col, endLine, endCol, status, vacuous, detail, constraints}`,
     * positioned over the whole `satisfy` statement; `vacuous` = satisfied
     * only because an assumption does not hold; `constraints` = the
     * verdicts it combines, `{unit, unitName, name, elementType, assumed,
     * line, col, endLine, endCol, status, detail, bindings}` (bindings
     * evaluated under the subject binding, chains like `x.mass` whole).
     * The summary counts claims alongside constraints.
     */
    verify(opts_json?: string | null): string;
    /**
     * Describe a `view` usage for tabular consumers: the rendering it
     * requests (`render …;` → the rendering usage's declared name; a
     * view with no `render` member of its own reports the one it
     * inherits from its definition or a view it specializes, the first
     * in heritage order when there are several), the elements it
     * exposes (its `expose` imports with the view's
     * `filter` conditions applied — the same exposure the CLI's
     * view-directed diagrams use), the view usages it owns (a matrix's
     * `columns` sub-view), and its prefix metadata with every owned
     * feature value evaluated (`@MatrixConfig { relationship = "…"; }`
     * → `{ "type": "…::MatrixConfig", "values": { "relationship": "…" } }`).
     * JSON `{ qualifiedName (canonical spelling), id, rendering, exposed: [{ id, qualifiedName,
     * metaclass }], views: [{ name, qualifiedName, id }], metadata: [{ type,
     * values }] }`; errors when the name does not resolve to a view usage.
     * Reads only; nothing is written into the model.
     */
    viewInfo(qualified_name: string): string;
    /**
     * Non-fatal problems from lifting interchange JSON, as a JSON
     * string array.
     */
    warnings(): string;
}

/**
 * The outcomes a session's build settled on, held apart from the
 * session for the next build of mostly the same units to start from
 * (see [`Session::from_sources_settled`]). The handle keeps only the
 * outcomes — each reference's fingerprint and the identity of its
 * target — so the session that produced it may be freed before the
 * next build; free the handle once a build has taken it, or keep the
 * latest one across edits.
 */
export class SettledOutcomes {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * How many units' outcomes the handle keeps.
     */
    unitCount(): number;
}

/**
 * The canonical spelling of an element name:
 * JSON `{"spelling", "quoted"}` — `spelling` is exactly what the
 * printer emits (bare, or a single-quoted restricted name for reserved
 * words and non-basic characters) and `quoted` says which. Errors when
 * the string cannot be a name (empty). `dialect` is `"sysml"` or
 * `"kerml"`; the reserved-word sets differ, and an omitted dialect
 * means SysML here (unlike `spellReference`, whose omitted dialect
 * means either). Generators that mint
 * names from external vocabularies call this instead of copying the
 * parser's keyword table.
 */
export function canonicalName(name: string, dialect?: string | null): string;

/**
 * Fingerprint of the effective canonicalization policy under a lint
 * configuration (absent/empty = engine defaults): resolved formatter
 * options + enabled auto-fix rules/options + the canonicalizer
 * schema version — the `canonicalizationDigest` provenance baseline.
 */
export function canonicalizationDigest(config_json?: string | null): string;

/**
 * Canonicalize a compact interchange element array (JSON text):
 * materialize every element through its metaclass field table and
 * re-emit with each absent property spelled at its metaclass-specific
 * default (`isUnique` true, `isAbstract` false, `visibility`
 * "public", empty lists, nulls, the `elementId` mirror of `@id`).
 * Present values and `@id`s are preserved verbatim, element order is
 * untouched, and the result is independent of the input's default
 * elision/spelling split — so producers that wire-elide schema
 * defaults and producers that spell them explicitly digest
 * identically. The CBOR round-trip does NOT do this (encode/decode is
 * presence-faithful); this is the rehydration entry point. Strict
 * like the encoder: unknown `@type`s and non-compact-form keys are
 * errors.
 */
export function canonicalizeCompact(json: string): string;

/**
 * Check sources (JSON `[{name, text}]`) the way `sysmlv2 check` does:
 * per-unit parse and body-context validation always; referential and
 * semantic checks against the standard library when `lib_sources_json`
 * (same shape) is given. Returns findings as a JSON string:
 * `[{severity, stage, message, unit, line, col, endLine, endCol}]`
 * (1-based positions; the end pair spans the full diagnostic, so
 * markers cover the whole offending construct rather than just its
 * start). `stage` is `parse`, `context`, `referential` or `semantic`;
 * only `parse` findings keep a unit out of a session. A broken parse
 * is a finding, not an error.
 */
export function check(sources_json: string, lib_sources_json?: string | null, lib_snapshot?: Uint8Array | null): string;

/**
 * The parse and context stages of [`check`] alone — no model is built,
 * so the cost is a parse per unit. The partition step of a host that
 * then opens a [`Session`] over the units that parsed and reads the
 * resolution stages from [`Session::check`].
 */
export function checkSyntax(sources_json: string): string;

/**
 * The s2c codec tables as JSON, for hosts that label raw payload
 * structure (the IDE's CBOR explorer): metaclass wire codes with
 * their per-ordinal field tables (property name, kind code, enum
 * table index) and the closed enum vocabularies. `full` selects the
 * full-form ordinal space; the compact tables cover every ingest
 * payload. Kind codes are the `cbor_tables` constants (0 bool,
 * 1 str, 2 str list, 3 ref, 4 ref list, 5 enum, 6 literal,
 * 7 element id).
 */
export function codecTables(full: boolean): string;

/**
 * s2c delta between two compact interchange element arrays (JSON
 * text), read base → target. With `rebase`, the target's element ids
 * are first rebased onto the base by ownership-path matching
 * (`sysmlv2_cbor::rebase_ids`) so independently derived payloads —
 * different unit names, separate lifts, foreign producers — diff by
 * structure instead of full create/delete churn; a rebase refusal
 * (id collision) falls back to the raw target, which still yields a
 * correct (just larger) delta. Same-session payloads should pass
 * `rebase: false`: session identity survives moves, which path
 * matching cannot see.
 * Optional tail arguments: `units_json` — the target's unit
 * structure as JSON `[[index, path], …]` (indices into the target
 * array as passed) rides the payload so file adds/renames/deletes
 * travel with the delta (strict only). `elide` — id-elided
 * created records encoded resolver-less: foreign ids land in
 * the exception map, which is always safe (the applier's digest gate
 * proves recovery); apply through a session for library context.
 */
export function deltaCborBetween(base_json: string, target_json: string, portable: boolean, rebase: boolean, units_json?: string | null, elide?: boolean | null): Uint8Array;

/**
 * Inspect an s2c payload without decoding or applying it: form,
 * header versions, sizes and counts, and for deltas the
 * digests, claims, and change breakdown — the summary a host renders
 * as a payload preview. Returns the summary as JSON text.
 */
export function describeCbor(bytes: Uint8Array): string;

/**
 * Encode any compact interchange element array (JSON text) to s2c
 * bytes (`CBOR.md`) — the element-scoped export path, where the host
 * filters a subtree out of the session's compact array first.
 * Whole-session exports use [`Session::to_compact_cbor`]. References
 * to elements outside the array travel in the payload's external
 * table, so a filtered subtree is a valid payload.
 */
export function encodeCompactCbor(json: string): Uint8Array;

/**
 * Format one standalone KerML query expression — a query document's
 * statement, which is an expression rather than a model unit, so the
 * model formatter does not apply. `->` chain steps, invocation
 * arguments, and lambda-body results break one per line wherever the
 * flat form would outrun `width` (default 80); anything that fits
 * stays on one line. Rejects input that is not a single well-formed
 * expression, reporting the first diagnostic — a formatter must not
 * guess at broken input.
 */
export function formatQuery(text: string, indent?: string | null, width?: number | null): string;

/**
 * Format SysML source text canonically under a project's lint
 * configuration: `config_json` is the sysmlint.json content (absent or
 * empty = engine defaults), read by the same parser the lint engine
 * uses, so the indentation style (`indentation` rule `style`/`size`)
 * and the multiline-chain threshold (`multiline-conditions` `min`)
 * can never disagree with what `lint` enforces. Parses, then re-prints
 * preserving notes and single blank lines. Rejects source with parse
 * diagnostics — a formatter must not guess at broken input — reporting
 * the first as `"<line>:<col> <message>"` (1-based, byte columns) so
 * hosts can map it onto their own spans.
 */
export function formatSource(text: string, config_json?: string | null): string;

/**
 * The mirror twin of [`canonicalize_compact`]: re-spell a compact
 * interchange element array (JSON text) in the **graph-normal**
 * (stored/wire-normal) form a graph-backed store reconstructs after
 * materializing it as triples — default-valued properties elided,
 * derived canonical properties (`owner`, `qualifiedName`, …) dropped
 * as such a store's ingest drops them, `elementId` always spelled,
 * absent ownership backpointers completed by first-claimant
 * derivation from the forward ownership lists, each literal's number
 * spelled as its value type spells it (a `LiteralRational`'s `150` as
 * `150.0`, a `LiteralInteger`'s `150.0` as `150`), elements sorted by
 * `@id`. `stateDigestOf(graphNormalizeCompact(doc))` is the digest
 * such a store reconstructs after ingesting `doc`, so snapshots (and
 * strict deltas whose base digests live in the same domain) encoded
 * from this spelling pass the store's end-to-end digest
 * verification; a document printed through `JSON.parse` and
 * `JSON.stringify`, which drop a whole float's fraction, digests as
 * the kernel's own spelling of it does. Idempotent; strict on unknown
 * `@type`s, missing `@id`s, and keys outside the full schema.
 * Optional `as_spelled`: keep each literal's number as the document
 * spells it, as this normalization did before every spelling of a
 * value was one — a digest recorded then is checked against it.
 */
export function graphNormalizeCompact(json: string, as_spelled?: boolean | null): string;

/**
 * Runs once when the module is instantiated: routes every panic
 * report to the host's `console.error`. On this target a panic has no
 * stderr to print to and then traps the instance — the host sees a
 * bare `RuntimeError: unreachable` — so without the hook the reason
 * is lost. The trapped instance is not recoverable (a session may be
 * half-mutated): a host that catches a `RuntimeError` must discard
 * the module instance and instantiate the module again.
 */
export function install_panic_hook(): void;

/**
 * Repair sources (JSON `[{name, text}]`) that fail to parse so a
 * session can be built over what parsed: a member carrying a parse
 * error is removed (a failed member the parser skipped is recovered
 * from the tokens around the error), bodies left open at the end of a
 * unit get their closers appended, until each unit parses. Returns JSON
 * `{sources: [{name, text}], dropped: [{unit, start, end, line, col,
 * endLine, endCol, text, inserted, linesRemoved, wholeLines, message}],
 * unrepaired: [{unit, line, col, message}]}` — `dropped` in the
 * original texts' coordinates (byte offsets and byte columns, as `check`
 * reports; `inserted` holds appended closers, then `text` is empty and
 * the span is empty; `linesRemoved` and `wholeLines` map a line of the
 * repaired text back to the original), `unrepaired` naming units still
 * broken after the repair, positioned in their repaired text. Units
 * that parse come back unchanged.
 */
export function lenientSources(sources_json: string): string;

/**
 * The lint rule inventory (for configuration UIs): JSON
 * `[{id, description, default, styles, families: [{key, label,
 * defaultStyle}], scopes: [{key, label, default, defaultStyle}]}]`
 * in the engine's documentation order — `default` = "off" | "hint" |
 * "info" | "warn" | "error" (a scope's null = inherits the rule; a
 * scope's non-null default is soft — rule-level "off" silences it),
 * `styles` the preset
 * names styled scopes accept (empty = severity-only scopes),
 * `families` the rule's family-level style options. Sourced from the
 * engine's own registry, so a form built from it can never drift
 * from the rules that actually run.
 */
export function lintRules(): string;

/**
 * The id-normalized structural digest of exactly one member's text
 * (top-level form, as the canonical formatter emits it) — the
 * `structureDigest` provenance baseline. A
 * pure function of the text: parsed standalone, so it is independent
 * of the member's surroundings and of which session computed it.
 * Errors name the first parse diagnostic or a member-count violation.
 */
export function memberStructureDigest(text: string): string;

/**
 * Enable or disable expanding quoted power-product unit spellings
 * (`'m³⋅s⁻²'` parsed into `m³/s²` when the unit element carries no
 * definition or conversion of its own). On by default; module-wide,
 * so hosts flip it once at startup or on a settings change.
 */
export function setUnitSpellingExpansion(on: boolean): void;

/**
 * Respell a canonical qualified name — as `qualifiedName` reports it,
 * or as interchange JSON carries it — as reference text that parses:
 * reserved words and non-basic names quoted per segment
 * (`spellReference("part::view")` is `'part'::'view'`). `dialect` is
 * `"sysml"` or `"kerml"` for text going into a unit of that kind;
 * omitted, the spelling re-parses in either (every reserved word of
 * both dialects is quoted). Hosts generating `import`/`expose` lines
 * call this instead of quoting segments themselves.
 */
export function spellReference(qualified_name: string, dialect?: string | null): string;

/**
 * State digest of a compact interchange element array (JSON text) —
 * over the document exactly as given, with no session lift in
 * between. This is the digest a delta names its base by
 * ([`Session::state_digest`] digests the *session's* model instead;
 * lifting a payload file into a session re-derives ids, so only the
 * raw digest can say whether a given payload file is a delta's
 * base).
 */
export function stateDigestOf(json: string): string;

/**
 * The toolkit version this module was built from.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_element_free: (a: number, b: number) => void;
    readonly __wbg_lspserver_free: (a: number, b: number) => void;
    readonly __wbg_preparedlibrary_free: (a: number, b: number) => void;
    readonly __wbg_session_free: (a: number, b: number) => void;
    readonly __wbg_settledoutcomes_free: (a: number, b: number) => void;
    readonly canonicalName: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly canonicalizationDigest: (a: number, b: number) => [number, number, number, number];
    readonly canonicalizeCompact: (a: number, b: number) => [number, number, number, number];
    readonly check: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly checkSyntax: (a: number, b: number) => [number, number, number, number];
    readonly codecTables: (a: number) => [number, number];
    readonly deltaCborBetween: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number, number];
    readonly describeCbor: (a: number, b: number) => [number, number, number, number];
    readonly encodeCompactCbor: (a: number, b: number) => [number, number, number, number];
    readonly formatQuery: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly formatSource: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly graphNormalizeCompact: (a: number, b: number, c: number) => [number, number, number, number];
    readonly install_panic_hook: () => void;
    readonly lenientSources: (a: number, b: number) => [number, number, number, number];
    readonly lintRules: () => [number, number];
    readonly lspserver_handle: (a: number, b: number, c: number) => [number, number, number, number];
    readonly lspserver_invalidateSessions: (a: number) => [number, number, number, number];
    readonly lspserver_new: () => number;
    readonly lspserver_setHideRedundantValueHints: (a: number, b: number) => [number, number, number, number];
    readonly lspserver_setInferUnitTypes: (a: number, b: number) => void;
    readonly lspserver_setNumberFormat: (a: number, b: number, c: number) => [number, number, number, number];
    readonly lspserver_setWorkspace: (a: number, b: number, c: number) => [number, number, number, number];
    readonly lspserver_withLibrary: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly lspserver_withPreparedLibrary: (a: number) => number;
    readonly memberStructureDigest: (a: number, b: number) => [number, number, number, number];
    readonly preparedlibrary_fromSnapshot: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly preparedlibrary_fromSnapshotStream: (a: any, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly preparedlibrary_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly session_annotatedElements: (a: number, b: number) => [number, number, number, number];
    readonly session_applyDeltaCbor: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly session_applyDeltaCborTo: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly session_applyDeltaCborToRaw: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly session_check: (a: number) => [number, number];
    readonly session_checkEdit: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_closurePolicy: (a: number) => [number, number];
    readonly session_computedNames: () => [number, number];
    readonly session_conforms: (a: number, b: number, c: number) => [number, number, number];
    readonly session_conformsWithImplied: (a: number, b: number, c: number) => [number, number, number];
    readonly session_declarationSite: (a: number, b: number) => [number, number, number, number];
    readonly session_decodeCbor: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_deltaCborFrom: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly session_derived: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly session_derivedElements: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly session_derives: (a: number, b: number, c: number, d: number) => [number, number];
    readonly session_docs: (a: number, b: number) => [number, number, number, number];
    readonly session_edit: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_elementById: (a: number, b: number, c: number) => number;
    readonly session_elementId: (a: number, b: number) => [number, number, number, number];
    readonly session_elementsOfMetaclass: (a: number, b: number, c: number) => [number, number];
    readonly session_evaluate: (a: number, b: number) => [number, number, number, number];
    readonly session_features: (a: number, b: number) => [number, number, number, number];
    readonly session_fromCompactCbor: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly session_fromCompactCborWithPreparedLibrary: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly session_fromInterchangeJson: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly session_fromInterchangeJsonWithPreparedLibrary: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly session_fromSources: (a: number, b: number) => [number, number, number];
    readonly session_fromSourcesSettled: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly session_fromSourcesWithLibrary: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly session_fromSourcesWithPreparedLibrary: (a: number, b: number, c: number) => [number, number, number];
    readonly session_generatedInventory: (a: number) => [number, number];
    readonly session_isLibraryElement: (a: number, b: number) => [number, number, number];
    readonly session_isOwnedProperty: (a: number, b: number, c: number, d: number) => number;
    readonly session_lint: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_loadLibrarySources: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly session_loadPreparedLibrary: (a: number, b: number) => [number, number];
    readonly session_memberExtent: (a: number, b: number) => [number, number, number, number];
    readonly session_memberSource: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_members: (a: number, b: number) => [number, number, number, number];
    readonly session_metaclass: (a: number, b: number) => [number, number, number, number];
    readonly session_minimalSpelling: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_minimizeQualifications: (a: number) => [number, number, number, number];
    readonly session_name: (a: number, b: number) => [number, number, number, number];
    readonly session_outline: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_owner: (a: number, b: number) => [number, number, number];
    readonly session_property: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly session_qualifiedName: (a: number, b: number) => [number, number, number, number];
    readonly session_query: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_redefinedChain: (a: number, b: number) => [number, number, number, number];
    readonly session_redefinitionRoot: (a: number, b: number) => [number, number, number];
    readonly session_referenceSpelling: (a: number, b: number) => [number, number, number, number];
    readonly session_references: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_resolve: (a: number, b: number, c: number) => number;
    readonly session_revealPath: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_roots: (a: number) => [number, number];
    readonly session_rows: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly session_setClosurePolicy: (a: number, b: number, c: number) => [number, number];
    readonly session_settledOutcomes: (a: number) => number;
    readonly session_shortName: (a: number, b: number) => [number, number, number, number];
    readonly session_source: (a: number, b: number) => [number, number];
    readonly session_stateDigest: (a: number) => [number, number];
    readonly session_toCompactCbor: (a: number) => [number, number];
    readonly session_toCompactCborElided: (a: number) => [number, number, number, number];
    readonly session_toCompactJson: (a: number) => [number, number];
    readonly session_toFullCbor: (a: number, b: number) => [number, number];
    readonly session_toFullJson: (a: number, b: number) => [number, number];
    readonly session_toFullJsonStrict: (a: number) => [number, number, number, number];
    readonly session_toGraph: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_toPlantuml: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_typings: (a: number, b: number) => [number, number, number, number];
    readonly session_unitTable: (a: number) => [number, number];
    readonly session_units: (a: number) => [number, number];
    readonly session_unresolvedCount: (a: number) => number;
    readonly session_valueIsDefault: (a: number, b: number) => [number, number, number];
    readonly session_valueSource: (a: number, b: number) => [number, number, number, number];
    readonly session_verify: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_viewInfo: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_warnings: (a: number) => [number, number];
    readonly setUnitSpellingExpansion: (a: number) => void;
    readonly settledoutcomes_unitCount: (a: number) => number;
    readonly spellReference: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly stateDigestOf: (a: number, b: number) => [number, number, number, number];
    readonly version: () => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
