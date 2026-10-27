/* @ts-self-types="./sysmlv2.d.ts" */

/**
 * An opaque handle to one element of a session's resolved model.
 */
export class Element {
    static __wrap(ptr) {
        const obj = Object.create(Element.prototype);
        obj.__wbg_ptr = ptr;
        ElementFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ElementFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_element_free(ptr, 0);
    }
}
if (Symbol.dispose) Element.prototype[Symbol.dispose] = Element.prototype.free;

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
    static __wrap(ptr) {
        const obj = Object.create(LspServer.prototype);
        obj.__wbg_ptr = ptr;
        LspServerFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        LspServerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_lspserver_free(ptr, 0);
    }
    /**
     * Handle one JSON-RPC message string; returns produced messages.
     * @param {string} msg
     * @returns {string[]}
     */
    handle(msg) {
        const ptr0 = passStringToWasm0(msg, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.lspserver_handle(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Drop cached navigation sessions after a host-side engine
     * reconfiguration (e.g. [`set_unit_spelling_expansion`]) that
     * changes answers without any source changing. Returns the
     * refresh requests to relay, like `setWorkspace`.
     * @returns {string[]}
     */
    invalidateSessions() {
        const ret = wasm.lspserver_invalidateSessions(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * The syntax-tier-only server (no standard library).
     * NOTE: a fallible `#[wasm_bindgen(constructor)]` (Result return)
     * leaves the JS object with a null pointer — keep the constructor
     * infallible and use [`Self::with_library`] for the library shape.
     */
    constructor() {
        const ret = wasm.lspserver_new();
        this.__wbg_ptr = ret;
        LspServerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Set whether evaluated-value inlay hints that restate the
     * declared expression verbatim are suppressed (default on).
     * Returns the refresh requests to relay, like
     * `setWorkspace`.
     * @param {boolean} on
     * @returns {string[]}
     */
    setHideRedundantValueHints(on) {
        const ret = wasm.lspserver_setHideRedundantValueHints(this.__wbg_ptr, on);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Set whether accepting a unit completion inside an untyped
     * attribute's quantity bracket also declares the type the unit
     * determines (default on). Takes effect on the next completion
     * request.
     * @param {boolean} on
     */
    setInferUnitTypes(on) {
        wasm.lspserver_setInferUnitTypes(this.__wbg_ptr, on);
    }
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
     * @param {string} spec
     * @returns {string[]}
     */
    setNumberFormat(spec) {
        const ptr0 = passStringToWasm0(spec, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.lspserver_setNumberFormat(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
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
     * @param {string} sources_json
     * @returns {string[]}
     */
    setWorkspace(sources_json) {
        const ptr0 = passStringToWasm0(sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.lspserver_setWorkspace(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * A server whose navigation and completions see the standard
     * library: sources as JSON `[{name, text}]`, optionally with the
     * sealed resolution snapshot recorded against the same units.
     * @param {string} lib_sources_json
     * @param {Uint8Array | null} [lib_snapshot]
     * @returns {LspServer}
     */
    static withLibrary(lib_sources_json, lib_snapshot) {
        const ptr0 = passStringToWasm0(lib_sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(lib_snapshot) ? 0 : passArray8ToWasm0(lib_snapshot, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.lspserver_withLibrary(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return LspServer.__wrap(ret[0]);
    }
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
     * @param {PreparedLibrary} library
     * @returns {LspServer}
     */
    static withPreparedLibrary(library) {
        _assertClass(library, PreparedLibrary);
        const ret = wasm.lspserver_withPreparedLibrary(library.__wbg_ptr);
        return LspServer.__wrap(ret);
    }
}
if (Symbol.dispose) LspServer.prototype[Symbol.dispose] = LspServer.prototype.free;

/**
 * An immutable library graph reusable across session builds and edits.
 * Prepare the final ordered source bundle once. Changed sources require a new
 * handle. Sessions retain the library independently of this handle's lifetime.
 */
export class PreparedLibrary {
    static __wrap(ptr) {
        const obj = Object.create(PreparedLibrary.prototype);
        obj.__wbg_ptr = ptr;
        PreparedLibraryFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PreparedLibraryFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_preparedlibrary_free(ptr, 0);
    }
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
     * @param {Uint8Array} view
     * @param {string} sources_json
     * @param {Uint8Array | null} [recording]
     * @param {boolean | null} [keepHostParts]
     * @returns {PreparedLibrary}
     */
    static fromSnapshotStream(view, sources_json, recording, keepHostParts) {
        const ptr0 = passStringToWasm0(sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(recording) ? 0 : passArray8ToWasm0(recording, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.preparedlibrary_fromSnapshotStream(view, ptr0, len0, ptr1, len1, isLikeNone(keepHostParts) ? 0xFFFFFF : keepHostParts ? 1 : 0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return PreparedLibrary.__wrap(ret[0]);
    }
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
     * @param {Uint8Array} snapshot
     * @param {string} sources_json
     * @param {Uint8Array | null} [recording]
     * @param {boolean | null} [keepHostParts]
     * @returns {PreparedLibrary}
     */
    static fromSnapshot(snapshot, sources_json, recording, keepHostParts) {
        const ptr0 = passArray8ToWasm0(snapshot, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(recording) ? 0 : passArray8ToWasm0(recording, wasm.__wbindgen_malloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.preparedlibrary_fromSnapshot(ptr0, len0, ptr1, len1, ptr2, len2, isLikeNone(keepHostParts) ? 0xFFFFFF : keepHostParts ? 1 : 0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return PreparedLibrary.__wrap(ret[0]);
    }
    /**
     * Prepare library sources (JSON `[{name, text}]`) with an optional sealed
     * resolution snapshot. Stale or corrupt snapshots fall back to source.
     * @param {string} sources_json
     * @param {Uint8Array | null} [snapshot]
     */
    constructor(sources_json, snapshot) {
        const ptr0 = passStringToWasm0(sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(snapshot) ? 0 : passArray8ToWasm0(snapshot, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.preparedlibrary_new(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        PreparedLibraryFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) PreparedLibrary.prototype[Symbol.dispose] = PreparedLibrary.prototype.free;

/**
 * A set of model sources (text or interchange JSON) with their resolved
 * model — `sysmlv2_transform::Session` behind a JS-shaped API.
 */
export class Session {
    static __wrap(ptr) {
        const obj = Object.create(Session.prototype);
        obj.__wbg_ptr = ptr;
        SessionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SessionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_session_free(ptr, 0);
    }
    /**
     * Explicit `about` targets of an annotating element, resolved.
     * @param {Element} e
     * @returns {Element[]}
     */
    annotatedElements(e) {
        _assertClass(e, Element);
        const ret = wasm.session_annotatedElements(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * [`Self::apply_delta_cbor_to`] with the applied result embedded
     * as a raw JSON **string** field (`resultJson`) instead of a
     * parsed value: host-language JSON parsers may re-canonicalize
     * numbers (`1.0` → `1`), which changes the compact-CBOR encoding
     * and therefore the state digest — a digest-faithful replay chain
     * must carry state documents as emitted strings end to end.
     * @param {Uint8Array} bytes
     * @param {string} base_json
     * @param {boolean} lenient
     * @returns {string}
     */
    applyDeltaCborToRaw(bytes, base_json, lenient) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(base_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.session_applyDeltaCborToRaw(this.__wbg_ptr, ptr0, len0, ptr1, len1, lenient);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Apply a delta payload against a caller-held base document (a
     * compact element array as JSON) instead of the session's own
     * model — the payload-file base path: a file base's identity is
     * the file's content, and lifting it into a session would
     * re-derive ids and change the digest a strict delta gates on.
     * The session provides the library context for elided created
     * ids; result shape as [`Self::apply_delta_cbor`].
     * @param {Uint8Array} bytes
     * @param {string} base_json
     * @param {boolean} lenient
     * @returns {string}
     */
    applyDeltaCborTo(bytes, base_json, lenient) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(base_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.session_applyDeltaCborTo(this.__wbg_ptr, ptr0, len0, ptr1, len1, lenient);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Apply a delta payload against the session's model. Returns JSON
     * `{ "result": [...], "report": { "baseMatched", "noopDeletes",
     * "upsertedUpdates", "replacedCreates" } }`; the session itself is
     * unchanged — the host decides what to do with the result. Strict
     * application refuses a wrong base; `lenient` applies portable
     * deltas best-effort with the report saying what happened.
     * @param {Uint8Array} bytes
     * @param {boolean} lenient
     * @returns {string}
     */
    applyDeltaCbor(bytes, lenient) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_applyDeltaCbor(this.__wbg_ptr, ptr0, len0, lenient);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Dry-run an edit batch (same ops JSON as [`Self::edit`]): the full
     * verified-commit pipeline — splice, reparse, rebuild, reference
     * checks — runs against copies and the session is untouched either
     * way (no rebuild, handles stay valid). Returns `{wouldCommit:
     * true, idMap, findings, splices}` — exactly what `edit` would
     * report — or `{wouldCommit: false, refusal}` with the exact
     * refusal it would roll back with (unresolvable op targets
     * included). Errors only for malformed ops JSON.
     * @param {string} ops_json
     * @returns {string}
     */
    checkEdit(ops_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(ops_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_checkEdit(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * The session's check findings — the same JSON the free [`check`]
     * returns for the session's sources and library, read off this
     * session's build instead of a second one (no parse-stage entries:
     * the session holds only units that parsed; without a library the
     * resolution stages are skipped, as `check` skips them). A host
     * that partitions its units by [`check_syntax`] and opens a
     * session over the ones that parsed gets every stage with one
     * resolution.
     * @returns {string}
     */
    check() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_check(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The closure policy `derived` answers under: `"passthrough"` (the
     * default), `"closure"` or `"closure-implied"`.
     * @returns {string}
     */
    closurePolicy() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_closurePolicy(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Every derived property name `derived` can answer on some
     * metaclass.
     * @returns {string[]}
     */
    static computedNames() {
        const ret = wasm.session_computedNames();
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Reachability including supported implied library and variation bases.
     * A negative result does not establish complete non-conformance.
     * @param {Element} e
     * @param {Element} ancestor
     * @returns {boolean}
     */
    conformsWithImplied(e, ancestor) {
        _assertClass(e, Element);
        _assertClass(ancestor, Element);
        const ret = wasm.session_conformsWithImplied(this.__wbg_ptr, e.__wbg_ptr, ancestor.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * Does `e` reach `ancestor` through the explicit specialization
     * closure?
     * @param {Element} e
     * @param {Element} ancestor
     * @returns {boolean}
     */
    conforms(e, ancestor) {
        _assertClass(e, Element);
        _assertClass(ancestor, Element);
        const ret = wasm.session_conforms(this.__wbg_ptr, e.__wbg_ptr, ancestor.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * @param {Element} e
     * @returns {string | undefined}
     */
    declarationSite(e) {
        _assertClass(e, Element);
        const ret = wasm.session_declarationSite(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Decode any snapshot-form s2c payload (compact, id-elided, or
     * full) to its element array as JSON text, naming elided targets
     * through the session's library. Delta payloads refuse with their
     * pointed message — apply those with [`Self::apply_delta_cbor`].
     * @param {Uint8Array} bytes
     * @returns {string}
     */
    decodeCbor(bytes) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_decodeCbor(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Encode the delta from `base_json` (a compact element array) to
     * this session's model as an s2c delta payload. `portable`
     * selects id-keyed identities for best-effort application to
     * divergent bases; the strict default is smaller and digest-gated.
     * @param {string} base_json
     * @param {boolean} portable
     * @returns {Uint8Array}
     */
    deltaCborFrom(base_json, portable) {
        const ptr0 = passStringToWasm0(base_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_deltaCborFrom(this.__wbg_ptr, ptr0, len0, portable);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * The element handles of the derived property `name` of `e`: the
     * element of a single-valued value, the elements of a list, the
     * in-model targets of a reference-typed value — a target outside the
     * model has no handle and is *dropped* here (it is in
     * [`Self::derived`]'s JSON as an `outside` object); empty for a
     * string or boolean. Errors as `derived` does.
     * @param {Element} e
     * @param {string} name
     * @returns {Element[]}
     */
    derivedElements(e, name) {
        _assertClass(e, Element);
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_derivedElements(this.__wbg_ptr, e.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
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
     * @param {Element} e
     * @param {string} name
     * @returns {string}
     */
    derived(e, name) {
        let deferred3_0;
        let deferred3_1;
        try {
            _assertClass(e, Element);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_derived(this.__wbg_ptr, e.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * What `derived` answers for `name` on elements of `metaclass`,
     * decided without a model: `"not-declared"`, `"not-computed"`,
     * `"passthrough"` or `"exact"`.
     * @param {string} metaclass
     * @param {string} name
     * @returns {string}
     */
    static derives(metaclass, name) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(metaclass, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.session_derives(ptr0, len0, ptr1, len1);
            deferred3_0 = ret[0];
            deferred3_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * The element's documentation/comment bodies, display-normalized,
     * in declaration order: `doc` members annotating it plus comments
     * naming it in `about`.
     * @param {Element} e
     * @returns {string[]}
     */
    docs(e) {
        _assertClass(e, Element);
        const ret = wasm.session_docs(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
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
     * @param {string} ops_json
     * @returns {string}
     */
    edit(ops_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(ops_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_edit(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Look up an interchange UUID, including unnamed and library elements.
     * Returns no handle for malformed or absent IDs. Like name-resolved
     * handles, the result goes stale when the session is rebuilt.
     * @param {string} id
     * @returns {Element | undefined}
     */
    elementById(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_elementById(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : Element.__wrap(ret);
    }
    /**
     * The element's interchange `@id`.
     * @param {Element} e
     * @returns {string}
     */
    elementId(e) {
        let deferred2_0;
        let deferred2_1;
        try {
            _assertClass(e, Element);
            const ret = wasm.session_elementId(this.__wbg_ptr, e.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Every element of the given metaclass.
     * @param {string} ty
     * @returns {Element[]}
     */
    elementsOfMetaclass(ty) {
        const ptr0 = passStringToWasm0(ty, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_elementsOfMetaclass(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Evaluate `e`'s bound feature value; JSON, as in [`Self::query`].
     * @param {Element} e
     * @returns {string}
     */
    evaluate(e) {
        let deferred2_0;
        let deferred2_1;
        try {
            _assertClass(e, Element);
            const ret = wasm.session_evaluate(this.__wbg_ptr, e.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Members owned via FeatureMembership kinds (KerML `ownedFeature`).
     * @param {Element} e
     * @returns {Element[]}
     */
    features(e) {
        _assertClass(e, Element);
        const ret = wasm.session_features(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Open compact CBOR against a shared prepared library.
     * @param {Uint8Array} bytes
     * @param {PreparedLibrary} library
     * @param {string | null} [indent]
     * @returns {Session}
     */
    static fromCompactCborWithPreparedLibrary(bytes, library, indent) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(library, PreparedLibrary);
        var ptr1 = isLikeNone(indent) ? 0 : passStringToWasm0(indent, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.session_fromCompactCborWithPreparedLibrary(ptr0, len0, library.__wbg_ptr, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Session.__wrap(ret[0]);
    }
    /**
     * Open a session over a compact-form CBOR payload (a `Uint8Array`)
     * — the binary counterpart of [`Self::from_interchange_json`];
     * library and indent arguments as there.
     * @param {Uint8Array} bytes
     * @param {string | null} [lib_sources_json]
     * @param {Uint8Array | null} [lib_snapshot]
     * @param {string | null} [indent]
     * @returns {Session}
     */
    static fromCompactCbor(bytes, lib_sources_json, lib_snapshot, indent) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(lib_sources_json) ? 0 : passStringToWasm0(lib_sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(lib_snapshot) ? 0 : passArray8ToWasm0(lib_snapshot, wasm.__wbindgen_malloc);
        var len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(indent) ? 0 : passStringToWasm0(indent, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len3 = WASM_VECTOR_LEN;
        const ret = wasm.session_fromCompactCbor(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Session.__wrap(ret[0]);
    }
    /**
     * Open interchange JSON against a shared prepared library.
     * @param {string} json
     * @param {PreparedLibrary} library
     * @param {string | null} [indent]
     * @returns {Session}
     */
    static fromInterchangeJsonWithPreparedLibrary(json, library, indent) {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(library, PreparedLibrary);
        var ptr1 = isLikeNone(indent) ? 0 : passStringToWasm0(indent, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.session_fromInterchangeJsonWithPreparedLibrary(ptr0, len0, library.__wbg_ptr, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Session.__wrap(ret[0]);
    }
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
     * @param {string} json
     * @param {string | null} [lib_sources_json]
     * @param {Uint8Array | null} [lib_snapshot]
     * @param {string | null} [indent]
     * @returns {Session}
     */
    static fromInterchangeJson(json, lib_sources_json, lib_snapshot, indent) {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(lib_sources_json) ? 0 : passStringToWasm0(lib_sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(lib_snapshot) ? 0 : passArray8ToWasm0(lib_snapshot, wasm.__wbindgen_malloc);
        var len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(indent) ? 0 : passStringToWasm0(indent, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len3 = WASM_VECTOR_LEN;
        const ret = wasm.session_fromInterchangeJson(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Session.__wrap(ret[0]);
    }
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
     * @param {string} sources_json
     * @param {PreparedLibrary} library
     * @param {SettledOutcomes} settled
     * @returns {Session}
     */
    static fromSourcesSettled(sources_json, library, settled) {
        const ptr0 = passStringToWasm0(sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(library, PreparedLibrary);
        _assertClass(settled, SettledOutcomes);
        const ret = wasm.session_fromSourcesSettled(ptr0, len0, library.__wbg_ptr, settled.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Session.__wrap(ret[0]);
    }
    /**
     * [`Self::from_sources`] resolved against standard-library sources
     * (JSON `[{name, text}]`, optional sealed snapshot — see
     * [`Self::from_interchange_json`]) in the same build. Opening a
     * session and then calling [`Self::load_library_sources`] resolves
     * the user units twice; this resolves them once.
     * @param {string} sources_json
     * @param {string | null} [lib_sources_json]
     * @param {Uint8Array | null} [lib_snapshot]
     * @returns {Session}
     */
    static fromSourcesWithLibrary(sources_json, lib_sources_json, lib_snapshot) {
        const ptr0 = passStringToWasm0(sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(lib_sources_json) ? 0 : passStringToWasm0(lib_sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(lib_snapshot) ? 0 : passArray8ToWasm0(lib_snapshot, wasm.__wbindgen_malloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.session_fromSourcesWithLibrary(ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Session.__wrap(ret[0]);
    }
    /**
     * Open sources against a shared prepared library in one model build.
     * @param {string} sources_json
     * @param {PreparedLibrary} library
     * @returns {Session}
     */
    static fromSourcesWithPreparedLibrary(sources_json, library) {
        const ptr0 = passStringToWasm0(sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(library, PreparedLibrary);
        const ret = wasm.session_fromSourcesWithPreparedLibrary(ptr0, len0, library.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Session.__wrap(ret[0]);
    }
    /**
     * Open a session over in-memory sources: JSON `[{name, text}]`.
     * Unit names ending in `.kerml` parse as KerML.
     * @param {string} sources_json
     * @returns {Session}
     */
    static fromSources(sources_json) {
        const ptr0 = passStringToWasm0(sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_fromSources(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Session.__wrap(ret[0]);
    }
    /**
     * The lint engine's validated generated-ownership join, exposed
     * directly to editor hosts. Unlike a host-side rescan this omits
     * every corrupt/ambiguous row (while `lint` reports why) and keeps
     * the guard contract in lockstep with sidecar ownership policy.
     * @returns {string}
     */
    generatedInventory() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_generatedInventory(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Whether the element belongs to a loaded library.
     * @param {Element} e
     * @returns {boolean}
     */
    isLibraryElement(e) {
        _assertClass(e, Element);
        const ret = wasm.session_isLibraryElement(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * Whether the abstract syntax owns `name` on `metaclass`.
     * @param {string} metaclass
     * @param {string} name
     * @returns {boolean}
     */
    static isOwnedProperty(metaclass, name) {
        const ptr0 = passStringToWasm0(metaclass, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.session_isOwnedProperty(ptr0, len0, ptr1, len1);
        return ret !== 0;
    }
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
     * @param {string | null} [config_json]
     * @returns {string}
     */
    lint(config_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            var ptr0 = isLikeNone(config_json) ? 0 : passStringToWasm0(config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_lint(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Resolve against standard-library sources (JSON `[{name, text}]`),
     * optionally with a sealed resolution snapshot (see
     * [`Self::from_interchange_json`]). Rebuilds the session:
     * outstanding handles go stale.
     * @param {string} sources_json
     * @param {Uint8Array | null} [snapshot]
     */
    loadLibrarySources(sources_json, snapshot) {
        const ptr0 = passStringToWasm0(sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(snapshot) ? 0 : passArray8ToWasm0(snapshot, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.session_loadLibrarySources(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Attach a shared prepared library and rebuild; existing element handles
     * become stale, just as with `loadLibrarySources`.
     * @param {PreparedLibrary} library
     */
    loadPreparedLibrary(library) {
        _assertClass(library, PreparedLibrary);
        const ret = wasm.session_loadPreparedLibrary(this.__wbg_ptr, library.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
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
     * @param {Element} e
     * @returns {string | undefined}
     */
    memberExtent(e) {
        _assertClass(e, Element);
        const ret = wasm.session_memberExtent(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * The full source text of the member declaration that created the
     * element (target = `::`-qualified name or `@<interchange-id>`) —
     * what copy/paste carries between owners: feed it back through an
     * `insertMember` op. Errors for library elements and elements
     * without a recorded extent.
     * @param {string} target
     * @returns {string}
     */
    memberSource(target) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(target, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_memberSource(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Owned members, in declaration order (KerML `ownedMember`).
     * @param {Element} e
     * @returns {Element[]}
     */
    members(e) {
        _assertClass(e, Element);
        const ret = wasm.session_members(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * The element's abstract-syntax metaclass (`PartUsage`, …).
     * @param {Element} e
     * @returns {string}
     */
    metaclass(e) {
        let deferred2_0;
        let deferred2_1;
        try {
            _assertClass(e, Element);
            const ret = wasm.session_metaclass(this.__wbg_ptr, e.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * The shortest spelling of `target` that resolves to it from
     * inside `context`'s declaration — what a generated value
     * expression should write instead of the full qualified name
     * (same suffix discipline as minimize, without rewriting).
     * @param {Element} context
     * @param {Element} target
     * @returns {string | undefined}
     */
    minimalSpelling(context, target) {
        _assertClass(context, Element);
        _assertClass(target, Element);
        const ret = wasm.session_minimalSpelling(this.__wbg_ptr, context.__wbg_ptr, target.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Rewrite every plain reference site to the shortest suffix that
     * still resolves to the same element (reparse-verified; ids are
     * untouched by construction). Returns `{respelled, sites}`.
     * Element handles from before the call are invalidated — the
     * sources were rewritten and the model rebuilt.
     * @returns {string}
     */
    minimizeQualifications() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.session_minimizeQualifications(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * The element's declared name; the specification's `name` (an
     * unnamed feature named by what it redefines) is `derived(e, "name")`.
     * @param {Element} e
     * @returns {string | undefined}
     */
    name(e) {
        _assertClass(e, Element);
        const ret = wasm.session_name(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
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
     * @param {string | null} [opts_json]
     * @returns {string}
     */
    outline(opts_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            var ptr0 = isLikeNone(opts_json) ? 0 : passStringToWasm0(opts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_outline(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * The owning element (undefined for document roots).
     * @param {Element} e
     * @returns {Element | undefined}
     */
    owner(e) {
        _assertClass(e, Element);
        const ret = wasm.session_owner(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] === 0 ? undefined : Element.__wrap(ret[0]);
    }
    /**
     * Checked owned/derived property by specification name, encoded as JSON.
     * @param {Element} e
     * @param {string} name
     * @returns {string}
     */
    property(e, name) {
        let deferred3_0;
        let deferred3_1;
        try {
            _assertClass(e, Element);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_property(this.__wbg_ptr, e.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * The element's qualified name (undefined for anonymous elements):
     * the specification's derivation, in which a reserved word used as
     * a name stays bare (`part::view`). A model property, not source
     * text — splice [`Self::reference_spelling`] into generated
     * `import`/`expose` targets instead.
     * @param {Element} e
     * @returns {string | undefined}
     */
    qualifiedName(e) {
        _assertClass(e, Element);
        const ret = wasm.session_qualifiedName(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Evaluate an ad-hoc KerML query expression at the root namespace
     * (the `sysmlv2 query` semantics). Returns the value as JSON;
     * elements come back as `{"@element": id, "qualifiedName": …}`.
     * @param {string} expr
     * @returns {string}
     */
    query(expr) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(expr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_query(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * The links of the feature chain `e` redefines (`attribute :>>
     * chassis.mass`), first to last, resolved: the first such
     * redefinition's; empty when `e` redefines no chain.
     * @param {Element} e
     * @returns {Element[]}
     */
    redefinedChain(e) {
        _assertClass(e, Element);
        const ret = wasm.session_redefinedChain(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * The feature `e` stands for through its redefinitions by name —
     * the end of `e` → its first redefinition target → … — or `e`
     * itself. Features that redefine one feature, however many steps
     * apart, share a root.
     * @param {Element} e
     * @returns {Element}
     */
    redefinitionRoot(e) {
        _assertClass(e, Element);
        const ret = wasm.session_redefinitionRoot(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Element.__wrap(ret[0]);
    }
    /**
     * The element's qualified name spelled as reference text that
     * re-parses in either dialect: reserved words and non-basic names
     * quoted (`'part'::'view'` where `qualifiedName` reports
     * `part::view`). Undefined for anonymous elements.
     * @param {Element} e
     * @returns {string | undefined}
     */
    referenceSpelling(e) {
        _assertClass(e, Element);
        const ret = wasm.session_referenceSpelling(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
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
     * @param {string} selector_json
     * @returns {string}
     */
    references(selector_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(selector_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_references(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Resolve a `::`-qualified name to an element handle.
     * @param {string} qualified_name
     * @returns {Element | undefined}
     */
    resolve(qualified_name) {
        const ptr0 = passStringToWasm0(qualified_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_resolve(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : Element.__wrap(ret);
    }
    /**
     * The containers from the scope root down to an element (root
     * first, the element's owner last), for opening a summary picture
     * onto it: JSON `[{id, qualifiedName}]`. The selector is a
     * qualified name or `{elementId}`; errors when it does not resolve.
     * @param {string} selector_json
     * @returns {string}
     */
    revealPath(selector_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(selector_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_revealPath(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Top-level user elements: the owned members of each unit's root
     * namespace, in declaration order — the outline/tree entry point.
     * (Ownerless relationship records — memberships, typings, feature
     * values — are graph plumbing and never appear here.)
     * @returns {Element[]}
     */
    roots() {
        const ret = wasm.session_roots(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
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
     * @param {string} ids_json
     * @param {string} fields_json
     * @returns {string}
     */
    rows(ids_json, fields_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(fields_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.session_rows(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Set the closure policy (see `closurePolicy`).
     * @param {string} policy
     */
    setClosurePolicy(policy) {
        const ptr0 = passStringToWasm0(policy, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_setClosurePolicy(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * The outcomes this session's build settled on, for a session over
     * mostly the same units to start from ([`Self::from_sources_settled`]):
     * `undefined` unless the session was built on a prepared library and
     * its resolution ran more than one pass and settled — a build that
     * resolved in one pass, one that resolved the library together with
     * its units, or one that did not settle keeps none. A session rebuilt
     * by an edit or a library load keeps the outcomes of its latest build.
     * @returns {SettledOutcomes | undefined}
     */
    settledOutcomes() {
        const ret = wasm.session_settledOutcomes(this.__wbg_ptr);
        return ret === 0 ? undefined : SettledOutcomes.__wrap(ret);
    }
    /**
     * The element's declared short name (`<shortName>`), when it has one;
     * the specification's `shortName` is `derived(e, "shortName")`.
     * @param {Element} e
     * @returns {string | undefined}
     */
    shortName(e) {
        _assertClass(e, Element);
        const ret = wasm.session_shortName(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Current text of a unit by model unit index (undefined for
     * library units).
     * @param {number} unit
     * @returns {string | undefined}
     */
    source(unit) {
        const ret = wasm.session_source(this.__wbg_ptr, unit);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * The model's **state digest** — the content identity a delta
     * names its base by; emission-order-independent.
     * @returns {string}
     */
    stateDigest() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_stateDigest(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * [`Self::to_compact_cbor`] with **id elision**: graph-derivable
     * ids are omitted and receivers recompute them, verified by the
     * payload digest. The session's library names the effective-name
     * targets; decode against the same library version.
     * @returns {Uint8Array}
     */
    toCompactCborElided() {
        const ret = wasm.session_toCompactCborElided(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Compact-form CBOR for the session's model (a `Uint8Array`) — the
     * deterministic binary re-encoding of [`Self::to_compact_json`],
     * several times smaller on the wire and decodable back to the
     * identical element array.
     * @returns {Uint8Array}
     */
    toCompactCbor() {
        const ret = wasm.session_toCompactCbor(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Compact interchange JSON (KerML 10.4) for the session's model.
     * @returns {string}
     */
    toCompactJson() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_toCompactJson(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Full-form CBOR (a `Uint8Array`) — the binary re-encoding of
     * [`Self::to_full_json`]. Emit view only; transport the compact
     * form and expand at the edge.
     * @param {boolean} recover_refs
     * @returns {Uint8Array}
     */
    toFullCbor(recover_refs) {
        const ret = wasm.session_toFullCbor(this.__wbg_ptr, recover_refs);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Strict full JSON; no recovery elements or unavailable-value placeholders.
     * @returns {string}
     */
    toFullJsonStrict() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.session_toFullJsonStrict(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Full interchange JSON (derived properties + implied
     * relationships). With `recover_refs`, references that serialize as
     * dangling ids also carry their source spelling, so a partial model
     * survives emit → reload losslessly (the Flexo change-record path).
     * @param {boolean} recover_refs
     * @returns {string}
     */
    toFullJson(recover_refs) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_toFullJson(this.__wbg_ptr, recover_refs);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
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
     * @param {string | null} [opts_json]
     * @returns {string}
     */
    toGraph(opts_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            var ptr0 = isLikeNone(opts_json) ? 0 : passStringToWasm0(opts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_toGraph(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Emit a PlantUML diagram of the session's model. Options as
     * a JSON object (see `PlantumlOpts` docs); pass `undefined`/`"{}"`
     * for the defaults (tree view). Feed the text to any PlantUML build.
     * @param {string | null} [opts_json]
     * @returns {string}
     */
    toPlantuml(opts_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            var ptr0 = isLikeNone(opts_json) ? 0 : passStringToWasm0(opts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_toPlantuml(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Explicit FeatureTyping targets (`: T`), resolved.
     * @param {Element} e
     * @returns {Element[]}
     */
    typings(e) {
        _assertClass(e, Element);
        const ret = wasm.session_typings(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * The unit structure [`Self::to_compact_cbor`] carries, as JSON
     * `[[index, path], …]`: for each user unit, the compact element-array
     * index of its root namespace and the unit's source path — the
     * `units` that [`describe_cbor`] reports for that payload, read
     * without encoding it.
     * @returns {string}
     */
    unitTable() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_unitTable(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The user units as JSON `[{unit, name, text}]` (`unit` is the
     * model unit index).
     * @returns {string}
     */
    units() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_units(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * How many references failed to resolve.
     * @returns {number}
     */
    unresolvedCount() {
        const ret = wasm.session_unresolvedCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Whether `e`'s own value is a default (`default v`) rather than a
     * binding (`= v`); undefined when `e` declares no value.
     * @param {Element} e
     * @returns {boolean | undefined}
     */
    valueIsDefault(e) {
        _assertClass(e, Element);
        const ret = wasm.session_valueIsDefault(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] === 0xFFFFFF ? undefined : ret[0] !== 0;
    }
    /**
     * The source text of `e`'s bound value expression — the `<expr>`
     * in `= <expr>` — or undefined when the declaration carries no
     * value part (or the element has no user source). This is what a
     * value editor should prefill before the user rewrites it; feed
     * the replacement back through a `setFeatureValue` edit op, which
     * splices at the same recorded span.
     * @param {Element} e
     * @returns {string | undefined}
     */
    valueSource(e) {
        _assertClass(e, Element);
        const ret = wasm.session_valueSource(this.__wbg_ptr, e.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
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
     * @param {string | null} [opts_json]
     * @returns {string}
     */
    verify(opts_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            var ptr0 = isLikeNone(opts_json) ? 0 : passStringToWasm0(opts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_verify(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
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
     * @param {string} qualified_name
     * @returns {string}
     */
    viewInfo(qualified_name) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(qualified_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_viewInfo(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Non-fatal problems from lifting interchange JSON, as a JSON
     * string array.
     * @returns {string}
     */
    warnings() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_warnings(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) Session.prototype[Symbol.dispose] = Session.prototype.free;

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
    static __wrap(ptr) {
        const obj = Object.create(SettledOutcomes.prototype);
        obj.__wbg_ptr = ptr;
        SettledOutcomesFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SettledOutcomesFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_settledoutcomes_free(ptr, 0);
    }
    /**
     * How many units' outcomes the handle keeps.
     * @returns {number}
     */
    unitCount() {
        const ret = wasm.settledoutcomes_unitCount(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) SettledOutcomes.prototype[Symbol.dispose] = SettledOutcomes.prototype.free;

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
 * @param {string} name
 * @param {string | null} [dialect]
 * @returns {string}
 */
export function canonicalName(name, dialect) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(dialect) ? 0 : passStringToWasm0(dialect, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.canonicalName(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Fingerprint of the effective canonicalization policy under a lint
 * configuration (absent/empty = engine defaults): resolved formatter
 * options + enabled auto-fix rules/options + the canonicalizer
 * schema version — the `canonicalizationDigest` provenance baseline.
 * @param {string | null} [config_json]
 * @returns {string}
 */
export function canonicalizationDigest(config_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        var ptr0 = isLikeNone(config_json) ? 0 : passStringToWasm0(config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.canonicalizationDigest(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

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
 * @param {string} json
 * @returns {string}
 */
export function canonicalizeCompact(json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.canonicalizeCompact(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

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
 * @param {string} sources_json
 * @param {string | null} [lib_sources_json]
 * @param {Uint8Array | null} [lib_snapshot]
 * @returns {string}
 */
export function check(sources_json, lib_sources_json, lib_snapshot) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(lib_sources_json) ? 0 : passStringToWasm0(lib_sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(lib_snapshot) ? 0 : passArray8ToWasm0(lib_snapshot, wasm.__wbindgen_malloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.check(ptr0, len0, ptr1, len1, ptr2, len2);
        var ptr4 = ret[0];
        var len4 = ret[1];
        if (ret[3]) {
            ptr4 = 0; len4 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred5_0 = ptr4;
        deferred5_1 = len4;
        return getStringFromWasm0(ptr4, len4);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}

/**
 * The parse and context stages of [`check`] alone — no model is built,
 * so the cost is a parse per unit. The partition step of a host that
 * then opens a [`Session`] over the units that parsed and reads the
 * resolution stages from [`Session::check`].
 * @param {string} sources_json
 * @returns {string}
 */
export function checkSyntax(sources_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.checkSyntax(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * The s2c codec tables as JSON, for hosts that label raw payload
 * structure (the IDE's CBOR explorer): metaclass wire codes with
 * their per-ordinal field tables (property name, kind code, enum
 * table index) and the closed enum vocabularies. `full` selects the
 * full-form ordinal space; the compact tables cover every ingest
 * payload. Kind codes are the `cbor_tables` constants (0 bool,
 * 1 str, 2 str list, 3 ref, 4 ref list, 5 enum, 6 literal,
 * 7 element id).
 * @param {boolean} full
 * @returns {string}
 */
export function codecTables(full) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.codecTables(full);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

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
 * @param {string} base_json
 * @param {string} target_json
 * @param {boolean} portable
 * @param {boolean} rebase
 * @param {string | null} [units_json]
 * @param {boolean | null} [elide]
 * @returns {Uint8Array}
 */
export function deltaCborBetween(base_json, target_json, portable, rebase, units_json, elide) {
    const ptr0 = passStringToWasm0(base_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(target_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(units_json) ? 0 : passStringToWasm0(units_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.deltaCborBetween(ptr0, len0, ptr1, len1, portable, rebase, ptr2, len2, isLikeNone(elide) ? 0xFFFFFF : elide ? 1 : 0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * Inspect an s2c payload without decoding or applying it: form,
 * header versions, sizes and counts, and for deltas the
 * digests, claims, and change breakdown — the summary a host renders
 * as a payload preview. Returns the summary as JSON text.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function describeCbor(bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.describeCbor(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Encode any compact interchange element array (JSON text) to s2c
 * bytes (`CBOR.md`) — the element-scoped export path, where the host
 * filters a subtree out of the session's compact array first.
 * Whole-session exports use [`Session::to_compact_cbor`]. References
 * to elements outside the array travel in the payload's external
 * table, so a filtered subtree is a valid payload.
 * @param {string} json
 * @returns {Uint8Array}
 */
export function encodeCompactCbor(json) {
    const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.encodeCompactCbor(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Format one standalone KerML query expression — a query document's
 * statement, which is an expression rather than a model unit, so the
 * model formatter does not apply. `->` chain steps, invocation
 * arguments, and lambda-body results break one per line wherever the
 * flat form would outrun `width` (default 80); anything that fits
 * stays on one line. Rejects input that is not a single well-formed
 * expression, reporting the first diagnostic — a formatter must not
 * guess at broken input.
 * @param {string} text
 * @param {string | null} [indent]
 * @param {number | null} [width]
 * @returns {string}
 */
export function formatQuery(text, indent, width) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(indent) ? 0 : passStringToWasm0(indent, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.formatQuery(ptr0, len0, ptr1, len1, isLikeNone(width) ? Number.MAX_SAFE_INTEGER : (width) >>> 0);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

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
 * @param {string} text
 * @param {string | null} [config_json]
 * @returns {string}
 */
export function formatSource(text, config_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(config_json) ? 0 : passStringToWasm0(config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.formatSource(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

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
 * @param {string} json
 * @param {boolean | null} [as_spelled]
 * @returns {string}
 */
export function graphNormalizeCompact(json, as_spelled) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphNormalizeCompact(ptr0, len0, isLikeNone(as_spelled) ? 0xFFFFFF : as_spelled ? 1 : 0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Runs once when the module is instantiated: routes every panic
 * report to the host's `console.error`. On this target a panic has no
 * stderr to print to and then traps the instance — the host sees a
 * bare `RuntimeError: unreachable` — so without the hook the reason
 * is lost. The trapped instance is not recoverable (a session may be
 * half-mutated): a host that catches a `RuntimeError` must discard
 * the module instance and instantiate the module again.
 */
export function install_panic_hook() {
    wasm.install_panic_hook();
}

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
 * @param {string} sources_json
 * @returns {string}
 */
export function lenientSources(sources_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.lenientSources(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

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
 * @returns {string}
 */
export function lintRules() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.lintRules();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * The id-normalized structural digest of exactly one member's text
 * (top-level form, as the canonical formatter emits it) — the
 * `structureDigest` provenance baseline. A
 * pure function of the text: parsed standalone, so it is independent
 * of the member's surroundings and of which session computed it.
 * Errors name the first parse diagnostic or a member-count violation.
 * @param {string} text
 * @returns {string}
 */
export function memberStructureDigest(text) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.memberStructureDigest(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Enable or disable expanding quoted power-product unit spellings
 * (`'m³⋅s⁻²'` parsed into `m³/s²` when the unit element carries no
 * definition or conversion of its own). On by default; module-wide,
 * so hosts flip it once at startup or on a settings change.
 * @param {boolean} on
 */
export function setUnitSpellingExpansion(on) {
    wasm.setUnitSpellingExpansion(on);
}

/**
 * Respell a canonical qualified name — as `qualifiedName` reports it,
 * or as interchange JSON carries it — as reference text that parses:
 * reserved words and non-basic names quoted per segment
 * (`spellReference("part::view")` is `'part'::'view'`). `dialect` is
 * `"sysml"` or `"kerml"` for text going into a unit of that kind;
 * omitted, the spelling re-parses in either (every reserved word of
 * both dialects is quoted). Hosts generating `import`/`expose` lines
 * call this instead of quoting segments themselves.
 * @param {string} qualified_name
 * @param {string | null} [dialect]
 * @returns {string}
 */
export function spellReference(qualified_name, dialect) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(qualified_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(dialect) ? 0 : passStringToWasm0(dialect, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.spellReference(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * State digest of a compact interchange element array (JSON text) —
 * over the document exactly as given, with no session lift in
 * between. This is the digest a delta names its base by
 * ([`Session::state_digest`] digests the *session's* model instead;
 * lifting a payload file into a session re-derives ids, so only the
 * raw digest can say whether a given payload file is a delta's
 * base).
 * @param {string} json
 * @returns {string}
 */
export function stateDigestOf(json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.stateDigestOf(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * The toolkit version this module was built from.
 * @returns {string}
 */
export function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_element_new: function(arg0) {
            const ret = Element.__wrap(arg0);
            return ret;
        },
        __wbg_error_a05d47f83bec1a32: function(arg0, arg1) {
            console.error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_getRandomValues_973dabfb0ad1769f: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_length_7f3c00c40364105e: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_prototypesetcall_bc27214492979395: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_subarray_002b94d5e13d1411: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./sysmlv2_bg.js": import0,
    };
}

const ElementFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_element_free(ptr, 1));
const LspServerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_lspserver_free(ptr, 1));
const PreparedLibraryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_preparedlibrary_free(ptr, 1));
const SessionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_session_free(ptr, 1));
const SettledOutcomesFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_settledoutcomes_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('sysmlv2_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
