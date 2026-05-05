import type { ModelVariable, SimulationModel } from '@simulador/shared';
import { parseSubroutineLabel } from '../state/diagramAnalysis';
import {
  compileModel,
  rewriteEventTables,
  sanitizeIdent,
  type CompiledFlow,
  type CompiledModel,
  type CompiledNode,
} from './flowchartCompiler';

// =====================================================================
// Flowchart → C++ / Java / Go translator
// ---------------------------------------------------------------------
// Each emitter walks the IR produced by flowchartCompiler.compileModel and
// produces a self-contained source file that:
//   - declares the same variables (state / result / input / control as
//     primitives, event-table as an EventTable instance)
//   - reproduces the diagram's control flow as a switch over a `pc` integer
//     in run() / each procedure
//   - provides Mulberry32 RNG and event-table helpers in the target language
//   - prints the result-kind variables (or the variables listed in the
//     salida block's label when present) at end of run
//
// The expression translator is intentionally regex-based: it covers the
// idioms students actually type (assignments, comparisons, `RND()`, `Math.X`,
// HV) without bringing in a JS parser. Anything more exotic should be edited
// by hand in the generated file — the original JS is preserved as a comment.
// =====================================================================

type Lang = 'cpp' | 'java' | 'go';

// === Common JS-syntax cleanups (same across languages) ===============
function commonReplacements(src: string): string {
  return src
    .replace(/'([^'\\]*)'/g, '"$1"')
    .replace(/===/g, '==')
    .replace(/!==/g, '!=');
}

// === Per-language expression translation =============================
function translateExpr(src: string, lang: Lang, tables: ReadonlySet<string>): string {
  // Step 1: rewrite event-table operations (push/pop/peek) — same as runtime.
  let out = rewriteEventTables(src, tables);
  out = commonReplacements(out);
  // Step 2: drop `let/const/var` (locals are typed at the language level).
  out = out.replace(/\b(?:const|let|var)\s+(\w+)\s*=/g, '$1 =');
  // Step 3: language-specific syntax tweaks.
  if (lang === 'cpp') {
    out = out
      .replace(/\bMath\.(\w+)/g, 'std::$1')
      .replace(/\bRND\s*\(\s*\)/g, 'rng.next()')
      .replace(/\btrue\b/g, 'true')
      .replace(/\bfalse\b/g, 'false');
  } else if (lang === 'java') {
    // Math.X is already valid Java syntax. Keep as-is.
    out = out.replace(/\bRND\s*\(\s*\)/g, 'rng.next()');
  } else {
    // go: math fns use CapitalCase (math.Log, not math.log)
    out = out
      .replace(/\bMath\.(\w)(\w*)/g, (_, c: string, rest: string) =>
        `math.${c.toUpperCase()}${rest}`,
      )
      .replace(/\bRND\s*\(\s*\)/g, 'rng.Next()');
  }
  return out;
}

// === Type / literal helpers ==========================================
function isBoolVar(v: ModelVariable): boolean {
  return typeof v.initialValue === 'boolean';
}

function typeFor(v: ModelVariable, lang: Lang): string {
  if (v.kind === 'event-table') return 'EventTable';
  if (isBoolVar(v)) return lang === 'cpp' ? 'bool' : lang === 'java' ? 'boolean' : 'bool';
  if (typeof v.initialValue === 'string') {
    return lang === 'cpp' ? 'std::string' : lang === 'java' ? 'String' : 'string';
  }
  return lang === 'cpp' ? 'double' : lang === 'java' ? 'double' : 'float64';
}

function literalFor(v: ModelVariable, _lang: Lang): string {
  const x = v.initialValue;
  if (x === undefined || x === null) return '0';
  if (typeof x === 'string') return `"${x.replace(/"/g, '\\"')}"`;
  if (typeof x === 'boolean') return x ? 'true' : 'false';
  return String(x);
}

// === Salida → list of vars to print ==================================
// Each salida block's label is treated as a list of identifiers (separated by
// newlines or commas). We intersect with declared variables to avoid emitting
// references to symbols that don't exist. If nothing matches, fall back to
// every variable with kind === 'result'.
function pickPrintVars(
  salidaLabels: string[],
  variables: ModelVariable[],
  resultVariables: ModelVariable[],
): ModelVariable[] {
  const declaredByName = new Map(variables.map((v) => [v.name, v]));
  const collected: ModelVariable[] = [];
  const seen = new Set<string>();
  for (const label of salidaLabels) {
    for (const tokenRaw of label.split(/[\n,]+/)) {
      const token = tokenRaw.trim();
      const v = declaredByName.get(token);
      if (v && !seen.has(v.name)) {
        seen.add(v.name);
        collected.push(v);
      }
    }
  }
  return collected.length > 0 ? collected : resultVariables;
}

// === PC numbering ====================================================
// Each flow gets its own dense [0..N) numbering. The IR keeps node ids as
// strings; emitters convert via this map.
function numberFlow(flow: CompiledFlow): { ids: Map<string, number>; order: CompiledNode[] } {
  const ids = new Map<string, number>();
  const order: CompiledNode[] = [];
  // Start id first so case 0 is always the entry point — easier to read.
  const startNode = flow.nodes.get(flow.startId);
  if (startNode) {
    ids.set(flow.startId, 0);
    order.push(startNode);
  }
  for (const [id, node] of flow.nodes.entries()) {
    if (id === flow.startId) continue;
    ids.set(id, ids.size);
    order.push(node);
  }
  return { ids, order };
}

function pcOf(ids: Map<string, number>, id: string | null | undefined): string {
  if (id == null) return '-1';
  const n = ids.get(id);
  return n === undefined ? '-1' : String(n);
}

function commentOf(node: CompiledNode): string {
  const t = node.node.type ?? 'unknown';
  const lbl = (node.node.label ?? '').replace(/\s+/g, ' ').trim();
  return lbl ? `${t}: ${lbl}` : t;
}

// === Body emission (per node, per language) ==========================
// Returns the list of source-code lines for the case body, NOT including the
// `case N:` / `break;` framing — the caller wraps those.
function emitBody(
  node: CompiledNode,
  ids: Map<string, number>,
  cm: CompiledModel,
  lang: Lang,
  procReturnAssignTo: (procName: string, callerNodeId: string) => string | undefined,
): string[] {
  const lines: string[] = [];
  const stmtEnd = lang === 'go' ? '' : ';';
  const out: string[] = [];

  const data = (node.node.data ?? {}) as {
    callKind?: 'routine' | 'function' | 'subroutine';
    formula?: string;
    assignTo?: string;
  };
  const label = node.node.label ?? '';

  switch (node.node.type) {
    case 'initialConditions':
    case 'assignment': {
      const translated = translateExpr(label, lang, cm.eventTables).trim();
      if (translated) {
        for (const line of translated.split(/\r?\n/)) {
          const t = line.trim();
          if (!t) continue;
          out.push(t.endsWith(';') ? t : `${t}${stmtEnd}`);
        }
      }
      out.push(`pc = ${pcOf(ids, node.successor)}${stmtEnd}`);
      break;
    }
    case 'decision': {
      const cond = translateExpr(label, lang, cm.eventTables).trim() || 'false';
      const yes = pcOf(ids, node.yesSuccessor);
      const no = pcOf(ids, node.noSuccessor);
      if (lang === 'go') {
        // Go has no ternary operator — emit if/else.
        out.push(`if ${cond} {`);
        out.push(`\tpc = ${yes}`);
        out.push(`} else {`);
        out.push(`\tpc = ${no}`);
        out.push(`}`);
      } else {
        out.push(`pc = (${cond}) ? ${yes} : ${no}${stmtEnd}`);
      }
      break;
    }
    case 'routine': {
      if (data.callKind === 'function' && data.formula && data.formula.trim()) {
        const target = label.trim();
        if (target) {
          const stmt = `${target} = (${data.formula.trim()})`;
          const translated = translateExpr(stmt, lang, cm.eventTables).trim();
          out.push(translated.endsWith(';') ? translated : `${translated}${stmtEnd}`);
        }
      } else if (data.callKind === 'subroutine') {
        // Parse `[Y = ]NAME[ args]` so the lookup matches the procedures
        // map (which is keyed by NAME, not by the full label). Without
        // this, calls like "A = Arrepentimiento" never resolved and the
        // emitted code was a silent no-op — leaving any conditional that
        // depended on the call's return value stuck on its initial value
        // and breaking the simulation's halt logic.
        const parsed = parseSubroutineLabel(label);
        const procKey = parsed.procName.trim();
        const procIdent = sanitizeIdent(procKey);
        if (procKey && cm.procedures.has(procKey)) {
          // Procedure exists — emit a real function call. In Go we prefix
          // with `proc_` to dodge the "field and method with same name" error
          // (Arrepentimiento is both a state field and a procedure).
          if (lang === 'go') {
            out.push(`s.proc_${procIdent}()`);
          } else {
            out.push(`${procIdent}()${stmtEnd}`);
          }
          const assignTo = procReturnAssignTo(label.trim(), node.id);
          if (assignTo) {
            out.push(`${assignTo} = ${procIdent}${stmtEnd}`);
          }
        } else {
          out.push(`/* subrutina "${label}" sin entry — no-op */`);
        }
      }
      // Plain routine (callKind undefined/'routine') is a no-op.
      out.push(`pc = ${pcOf(ids, node.successor)}${stmtEnd}`);
      break;
    }
    case 'salida': {
      out.push(lang === 'go' ? `s.printResults()` : `printResults()${stmtEnd}`);
      out.push(`pc = -1${stmtEnd}`);
      break;
    }
    case 'connector':
    case 'comment':
    default: {
      // Pass-through: forward to successor (or leaf → return from procedure).
      out.push(`pc = ${pcOf(ids, node.successor)}${stmtEnd}`);
      break;
    }
  }

  for (const line of out) lines.push(line);
  return lines;
}

// === C++ emitter =====================================================
function emitCppFlow(
  fnName: string,
  flow: CompiledFlow,
  cm: CompiledModel,
  procReturnAssignTo: (procName: string, callerNodeId: string) => string | undefined,
): string {
  const { ids, order } = numberFlow(flow);
  if (order.length === 0) return `    void ${fnName}() { /* empty flow */ }\n`;

  const cases = order
    .map((n) => {
      const pc = ids.get(n.id);
      const body = emitBody(n, ids, cm, 'cpp', procReturnAssignTo);
      const lines = body.map((l) => `                ${l}`).join('\n');
      return `            case ${pc}: { /* ${commentOf(n)} */
${lines}
                break;
            }`;
    })
    .join('\n');

  return `    void ${fnName}() {
        int pc = 0;
        while (pc >= 0) {
            switch (pc) {
${cases}
                default: pc = -1; break;
            }
        }
    }
`;
}

export function toCpp(model: SimulationModel): string {
  const cm = compileModel(model);

  const stateFields = cm.variables
    .map((v) => {
      if (v.kind === 'event-table') return `    EventTable ${v.name};`;
      return `    ${typeFor(v, 'cpp')} ${v.name} = ${literalFor(v, 'cpp')};`;
    })
    .join('\n');

  const printVars = pickPrintVars(cm.salidaLabels, cm.variables, cm.resultVariables);
  const printBody = printVars.length
    ? printVars
        .map((v) => `        std::cout << "${v.name} = " << ${v.name} << "\\n";`)
        .join('\n')
    : '        // (no result variables to print)';

  const procEntries = Array.from(cm.procedures.entries());
  const procFns = procEntries
    .map(([name, flow]) =>
      emitCppFlow(sanitizeIdent(name), flow, cm, () => undefined),
    )
    .join('\n');

  const procDecls = procEntries.map(([name]) => `    void ${sanitizeIdent(name)}();`).join('\n');

  const mainFn = emitCppFlow(
    'run',
    cm.mainFlow,
    cm,
    (_procName, callerNodeId) => {
      // Search all flows (main + procedures) — a subroutine can call
      // another subroutine, so the caller node may live in any compiled
      // flow. Returns the assignTo declared in the call's label
      // (`Y = X args` syntax). The legacy `data.assignTo` field is gone
      // since the label-based form is the canonical source of truth.
      let caller = cm.mainFlow.nodes.get(callerNodeId);
      if (!caller) {
        for (const flow of cm.procedures.values()) {
          caller = flow.nodes.get(callerNodeId);
          if (caller) break;
        }
      }
      if (!caller) return undefined;
      const parsed = parseSubroutineLabel(caller.node.label ?? '');
      return parsed.assignTo ?? undefined;
    },
  );

  return `// Generated by Simulador — ${cm.modelName}
// Compile: g++ -O2 -std=c++17 simulation.cpp -o simulation && ./simulation

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

static const double HV = std::numeric_limits<double>::infinity();

class Rng {
    uint32_t state_;
public:
    explicit Rng(uint32_t seed) : state_(seed ? seed : 1u) {}
    double next() {
        state_ = state_ + 0x6d2b79f5u;
        uint32_t t = state_;
        t = ((t ^ (t >> 15)) * (t | 1u));
        t = t ^ (t + ((t ^ (t >> 7)) * (t | 61u)));
        return double(t ^ (t >> 14)) / 4294967296.0;
    }
};

class EventTable {
    std::vector<double> data_;
public:
    void push(double v) {
        // Assigning HV to a table is the cátedra convention for "clear".
        if (std::isinf(v)) { data_.clear(); return; }
        auto it = std::upper_bound(data_.begin(), data_.end(), v);
        data_.insert(it, v);
    }
    double peek() const { return data_.empty() ? HV : data_.front(); }
    double pop() {
        if (data_.empty()) throw std::runtime_error("Tabla vacía — no se puede pop");
        double v = data_.front();
        data_.erase(data_.begin());
        return v;
    }
};

class Sim {
public:
    Sim() : rng(${cm.seed}) {}

    Rng rng;
${stateFields}

${procDecls}

${mainFn}
    void printResults() {
${printBody}
    }
};

${procFns}

int main() {
    Sim sim;
    sim.run();
    return 0;
}
`;
}

// === Java emitter ====================================================
function emitJavaFlow(
  fnName: string,
  flow: CompiledFlow,
  cm: CompiledModel,
  procReturnAssignTo: (procName: string, callerNodeId: string) => string | undefined,
): string {
  const { ids, order } = numberFlow(flow);
  if (order.length === 0) return `    void ${fnName}() { /* empty flow */ }\n`;

  const cases = order
    .map((n) => {
      const pc = ids.get(n.id);
      const body = emitBody(n, ids, cm, 'java', procReturnAssignTo);
      const lines = body.map((l) => `                    ${l}`).join('\n');
      return `                case ${pc}: { /* ${commentOf(n)} */
${lines}
                    break;
                }`;
    })
    .join('\n');

  return `    void ${fnName}() {
        int pc = 0;
        loop: while (pc >= 0) {
            switch (pc) {
${cases}
                default: pc = -1; break loop;
            }
        }
    }
`;
}

export function toJava(model: SimulationModel): string {
  const cm = compileModel(model);

  const stateFields = cm.variables
    .map((v) => {
      if (v.kind === 'event-table') return `    EventTable ${v.name} = new EventTable();`;
      return `    ${typeFor(v, 'java')} ${v.name} = ${literalFor(v, 'java')};`;
    })
    .join('\n');

  const printVars = pickPrintVars(cm.salidaLabels, cm.variables, cm.resultVariables);
  const printBody = printVars.length
    ? printVars
        .map((v) => `        System.out.println("${v.name} = " + ${v.name});`)
        .join('\n')
    : '        // (no result variables to print)';

  const procEntries = Array.from(cm.procedures.entries());
  const procFns = procEntries
    .map(([name, flow]) =>
      emitJavaFlow(sanitizeIdent(name), flow, cm, () => undefined),
    )
    .join('\n');

  const mainFn = emitJavaFlow(
    'run',
    cm.mainFlow,
    cm,
    (_procName, callerNodeId) => {
      // Search all flows (main + procedures) — a subroutine can call
      // another subroutine, so the caller node may live in any compiled
      // flow. Returns the assignTo declared in the call's label
      // (`Y = X args` syntax). The legacy `data.assignTo` field is gone
      // since the label-based form is the canonical source of truth.
      let caller = cm.mainFlow.nodes.get(callerNodeId);
      if (!caller) {
        for (const flow of cm.procedures.values()) {
          caller = flow.nodes.get(callerNodeId);
          if (caller) break;
        }
      }
      if (!caller) return undefined;
      const parsed = parseSubroutineLabel(caller.node.label ?? '');
      return parsed.assignTo ?? undefined;
    },
  );

  return `// Generated by Simulador — ${cm.modelName}
// Compile: javac Simulation.java && java Simulation

import java.util.ArrayList;
import java.util.Collections;

public class Simulation {

    static final double HV = Double.POSITIVE_INFINITY;

    static class Rng {
        long state;
        Rng(long seed) { state = seed != 0 ? seed : 1L; }
        double next() {
            state = (state + 0x6d2b79f5L) & 0xFFFFFFFFL;
            long t = state;
            t = ((t ^ (t >>> 15)) * (t | 1L)) & 0xFFFFFFFFL;
            t = (t ^ (t + ((t ^ (t >>> 7)) * (t | 61L)))) & 0xFFFFFFFFL;
            return (double) ((t ^ (t >>> 14)) & 0xFFFFFFFFL) / 4294967296.0;
        }
    }

    static class EventTable {
        ArrayList<Double> data = new ArrayList<>();
        void push(double v) {
            if (Double.isInfinite(v)) { data.clear(); return; }
            int i = 0;
            while (i < data.size() && data.get(i) <= v) i++;
            data.add(i, v);
        }
        double peek() { return data.isEmpty() ? HV : data.get(0); }
        double pop() {
            if (data.isEmpty()) throw new RuntimeException("Tabla vacía — no se puede pop");
            return data.remove(0);
        }
    }

    Rng rng = new Rng(${cm.seed});
${stateFields}

${mainFn}
${procFns}
    void printResults() {
${printBody}
    }

    public static void main(String[] args) {
        Simulation sim = new Simulation();
        sim.run();
    }
}
`;
}

// === Go emitter ======================================================
function emitGoFlow(
  fnName: string,
  flow: CompiledFlow,
  cm: CompiledModel,
  procReturnAssignTo: (procName: string, callerNodeId: string) => string | undefined,
): string {
  const { ids, order } = numberFlow(flow);
  if (order.length === 0) return `func (s *Sim) ${fnName}() { /* empty flow */ }\n`;

  const cases = order
    .map((n) => {
      const pc = ids.get(n.id);
      const body = emitBody(n, ids, cm, 'go', procReturnAssignTo);
      // Go: rewrite bare identifier accesses to s.X
      const stateNames = new Set(cm.variables.map((v) => v.name));
      const rewritten = body.map((line) => rewriteGoStateAccess(line, stateNames, cm.eventTables));
      const lines = rewritten.map((l) => `\t\t\t${l}`).join('\n');
      return `\t\tcase ${pc}: /* ${commentOf(n)} */
${lines}`;
    })
    .join('\n');

  return `func (s *Sim) ${fnName}() {
\tpc := 0
\tfor pc >= 0 {
\t\tswitch pc {
${cases}
\t\tdefault:
\t\t\tpc = -1
\t\t}
\t}
}
`;
}

// In Go we don't have implicit `this` access — every state-field reference
// has to be qualified with `s.`. This naive rewriter prefixes any whole-word
// state name (including event-tables) with `s.`, except where the prefix is
// already there.
function rewriteGoStateAccess(
  line: string,
  stateNames: ReadonlySet<string>,
  tables: ReadonlySet<string>,
): string {
  let out = line;
  for (const name of stateNames) {
    const re = new RegExp(`(?<![A-Za-z0-9_.])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    out = out.replace(re, `s.${name}`);
  }
  // Also prefix `pc` reads/writes? No — pc is local to the function.
  // Also prefix `rng`? rng is a state field too, included via stateNames? No,
  // rng isn't in cm.variables. Prefix it manually.
  out = out.replace(/(?<![A-Za-z0-9_.])rng\.next\b/g, 'rng.Next').replace(/(?<![A-Za-z0-9_.])rng\b/g, 's.rng');
  // Fix double-prefix that the rng substitution can produce.
  out = out.replace(/s\.s\./g, 's.');
  // Event-table calls are already qualified after the state prefix above
  // (e.g. TPLL.peek() → s.TPLL.peek()). Method names stay lowercase.
  void tables;
  return out;
}

export function toGo(model: SimulationModel): string {
  const cm = compileModel(model);

  // In Go, struct fields have their type AFTER the name — different layout
  // from C++/Java. Build them manually.
  const stateFields = cm.variables
    .map((v) => {
      if (v.kind === 'event-table') return `\t${v.name} EventTable`;
      const t = typeFor(v, 'go');
      return `\t${v.name} ${t}`;
    })
    .join('\n');

  const stateInit = cm.variables
    .filter((v) => v.kind !== 'event-table')
    .map((v) => `\ts.${v.name} = ${literalFor(v, 'go')}`)
    .join('\n');

  const printVars = pickPrintVars(cm.salidaLabels, cm.variables, cm.resultVariables);
  const printBody = printVars.length
    ? printVars
        .map((v) => `\tfmt.Printf("${v.name} = %v\\n", s.${v.name})`)
        .join('\n')
    : '\t// (no result variables to print)';

  const procEntries = Array.from(cm.procedures.entries());
  const procFns = procEntries
    .map(([name, flow]) =>
      // proc_ prefix: keeps the receiver method name distinct from the state
      // field of the same name (Go forbids `field and method with same name`).
      emitGoFlow(`proc_${sanitizeIdent(name)}`, flow, cm, () => undefined),
    )
    .join('\n');

  const mainFn = emitGoFlow(
    'Run',
    cm.mainFlow,
    cm,
    (_procName, callerNodeId) => {
      // Search all flows (main + procedures) — a subroutine can call
      // another subroutine, so the caller node may live in any compiled
      // flow. Returns the assignTo declared in the call's label
      // (`Y = X args` syntax). The legacy `data.assignTo` field is gone
      // since the label-based form is the canonical source of truth.
      let caller = cm.mainFlow.nodes.get(callerNodeId);
      if (!caller) {
        for (const flow of cm.procedures.values()) {
          caller = flow.nodes.get(callerNodeId);
          if (caller) break;
        }
      }
      if (!caller) return undefined;
      const parsed = parseSubroutineLabel(caller.node.label ?? '');
      return parsed.assignTo ?? undefined;
    },
  );

  return `// Generated by Simulador — ${cm.modelName}
// Build:  go run simulation.go

package main

import (
\t"fmt"
\t"math"
\t"sort"
)

var HV = math.Inf(1)

type Rng struct{ state uint32 }

func NewRng(seed uint32) *Rng {
\tif seed == 0 {
\t\tseed = 1
\t}
\treturn &Rng{state: seed}
}
func (r *Rng) Next() float64 {
\tr.state = r.state + 0x6d2b79f5
\tt := r.state
\tt = (t ^ (t >> 15)) * (t | 1)
\tt = t ^ (t + (t^(t>>7))*(t|61))
\treturn float64(t^(t>>14)) / 4294967296.0
}

type EventTable struct{ data []float64 }

func (e *EventTable) push(v float64) {
\tif math.IsInf(v, 1) {
\t\te.data = e.data[:0]
\t\treturn
\t}
\ti := sort.SearchFloat64s(e.data, v)
\te.data = append(e.data, 0)
\tcopy(e.data[i+1:], e.data[i:])
\te.data[i] = v
}
func (e *EventTable) peek() float64 {
\tif len(e.data) == 0 {
\t\treturn HV
\t}
\treturn e.data[0]
}
func (e *EventTable) pop() float64 {
\tif len(e.data) == 0 {
\t\tpanic("Tabla vacía — no se puede pop")
\t}
\tv := e.data[0]
\te.data = e.data[1:]
\treturn v
}

type Sim struct {
\trng *Rng
${stateFields}
}

func NewSim() *Sim {
\ts := &Sim{rng: NewRng(${cm.seed})}
${stateInit}
\treturn s
}

${mainFn}${procFns}
func (s *Sim) printResults() {
${printBody}
}

func main() {
\ts := NewSim()
\ts.Run()
}
`;
}
