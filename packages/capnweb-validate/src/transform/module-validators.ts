// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

// Owns registration and emission order for all validators in one source module.
import type { ValidationMode } from "../internal/core.js";
import { emitValidator } from "./emit.js";
import type { ServiceShape, TypeShape } from "./type-introspector.js";

export class ModuleValidators {
  #emitted = new Map<
    string,
    { bindingName: string; shape: ServiceShape; signature: string }[]
  >();
  #order: {
    bindingName: string;
    shape: ServiceShape;
    side: "server" | "client";
  }[] = [];
  #signatures = new WeakMap<ServiceShape, string>();

  private signature(shape: ServiceShape): string {
    let existing = this.#signatures.get(shape);
    if (existing) return existing;
    let signature = serviceSignature(shape);
    this.#signatures.set(shape, signature);
    return signature;
  }

  bind(shape: ServiceShape, side: "server" | "client"): string {
    let key = `${side}:${shape.name}`;
    let entries = this.#emitted.get(key) ?? [];
    let signature = this.signature(shape);
    let existing = entries.find((entry) => entry.signature === signature);
    if (existing) return existing.bindingName;
    let suffix = entries.length === 0 ? "" : `_${entries.length + 1}`;
    let bindingName = `__capnweb_validate_${sanitize(
      shape.name
    )}_${side}${suffix}`;
    let entry = { bindingName, shape, signature };
    entries.push(entry);
    this.#emitted.set(key, entries);
    forEachNestedService(shape, (nested) => this.bind(nested, side));
    this.#order.push({ bindingName, shape, side });
    return bindingName;
  }

  private lookup(shape: ServiceShape, side: "server" | "client"): string | undefined {
    let key = `${side}:${shape.name}`;
    let signature = this.signature(shape);
    return this.#emitted
      .get(key)
      ?.find((entry) => entry.signature === signature)
      ?.bindingName;
  }

  emit(serverMode: ValidationMode): string {
    let emitted = this.#order;
    let prelude = "";
    let emittedIndex = new Map(
      emitted.map((entry, index) => [entry.bindingName, index])
    );
    // Nested services resolved from one root share the same named-shape map.
    // Assign that map one binding namespace and emit it once rather than once
    // for every service in the capability graph.
    let namedShapeOwners = new Map<Map<number, TypeShape>, string>();
    for (let entry of emitted) {
      if (!namedShapeOwners.has(entry.shape.namedShapes)) {
        namedShapeOwners.set(entry.shape.namedShapes, entry.bindingName);
      }
    }
    for (let entry of emitted) {
      prelude += `let ${entry.bindingName};\n`;
    }
    for (let entry of emitted) {
      let mode = entry.side === "client" ? "throw" : serverMode;
      prelude +=
        emitValidator(entry.bindingName, entry.shape, mode, entry.side, {
          assign: true,
          emitNamedShapes:
            namedShapeOwners.get(entry.shape.namedShapes) === entry.bindingName,
          namedShapeBindingName: namedShapeOwners.get(entry.shape.namedShapes),
          serviceBinding: (shape) => {
            let name = this.lookup(shape, entry.side);
            if (!name) return undefined;
            return {
              name,
              lazy: emittedIndex.get(name)! >= emittedIndex.get(entry.bindingName)!,
            };
          },
        }) + "\n";
    }
    return prelude;
  }
}

function forEachNestedService(
  service: ServiceShape,
  visit: (service: ServiceShape) => void
): void {
  let seenTypes = new Set<TypeShape>();
  let walk = (shape: TypeShape): void => {
    if (seenTypes.has(shape)) return;
    seenTypes.add(shape);
    switch (shape.kind) {
      case "array":
      case "set":
        walk(shape.element);
        return;
      case "map":
        walk(shape.key);
        walk(shape.value);
        return;
      case "tuple":
        shape.elements.forEach(walk);
        if (shape.rest) walk(shape.rest);
        return;
      case "object":
        Object.values(shape.properties).forEach(walk);
        if (shape.index) walk(shape.index);
        return;
      case "union":
        shape.branches.forEach(walk);
        return;
      case "ref": {
        let referenced = service.namedShapes.get(shape.id);
        if (referenced) walk(referenced);
        return;
      }
      case "stub":
        if (shape.service) visit(shape.service);
        return;
      default:
        return;
    }
  };
  for (let method of service.methods) {
    if (method.skipValidation) continue;
    method.params.forEach(walk);
    if (method.rest) walk(method.rest);
    walk(method.returns);
  }
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_$]/g, "_");
}

function serviceSignature(service: ServiceShape, ancestors: ServiceShape[] = []): string {
  let cycle = ancestors.indexOf(service);
  if (cycle !== -1) return JSON.stringify(["serviceRef", cycle]);
  ancestors = [...ancestors, service];
  let activeRefs = new Set<number>();
  return JSON.stringify({
    targetKind: service.targetKind ?? null,
    passthrough: service.passthrough ?? [],
    methods: service.methods.map((method) =>
      method.skipValidation
        ? {
            name: method.name,
            unchecked: true,
          }
        : {
            name: method.name,
            params: method.params.map((param) => typeSignature(param)),
            rest: method.rest ? typeSignature(method.rest) : null,
            returns: typeSignature(method.returns),
            // A getter and a same-named no-arg method share params/returns;
            // isGetter must distinguish them so dedup does not reuse one for the
            // other (the runtime validates a getter on read, a method on call).
            isGetter: method.isGetter ?? false,
          }
    ),
  });

  function typeSignature(shape: TypeShape): unknown {
    switch (shape.kind) {
      case "literal":
        return [shape.kind, shape.value];
      case "array":
        return [shape.kind, typeSignature(shape.element)];
      case "map":
        return [shape.kind, typeSignature(shape.key), typeSignature(shape.value)];
      case "set":
        return [shape.kind, typeSignature(shape.element)];
      case "tuple":
        return [
          shape.kind,
          shape.elements.map((element) => typeSignature(element)),
          shape.minLength ?? null,
          shape.rest ? typeSignature(shape.rest) : null,
        ];
      case "object":
        return [
          shape.kind,
          shape.name,
          sortedEntries(shape.properties),
          shape.index ? typeSignature(shape.index) : null,
        ];
      case "union":
        return [
          shape.kind,
          shape.branches.map((branch) => typeSignature(branch)),
        ];
      case "ref": {
        // Reference IDs belong to one resolved graph. Equal IDs in two graphs
        // do not imply equal types, so compare their definitions as well.
        if (activeRefs.has(shape.id)) return [shape.kind, shape.id];
        activeRefs.add(shape.id);
        let definition = service.namedShapes.get(shape.id);
        let signature = [shape.kind, shape.id,
          definition ? typeSignature(definition) : null];
        activeRefs.delete(shape.id);
        return signature;
      }
      case "typedArray":
        return [shape.kind, shape.name];
      case "stub":
        return [
          shape.kind,
          shape.service ? serviceSignature(shape.service, ancestors) : null,
        ];
      case "unsupported":
        return [
          shape.kind,
          shape.reason,
          shape.typeExpr ?? null,
          shape.fixHint ?? null,
        ];
      default:
        return [shape.kind];
    }
  }

  function sortedEntries(properties: Record<string, TypeShape>): unknown[] {
    return Object.entries(properties)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, typeSignature(value)]);
  }
}
