// Centralized registry of *field-level* validity rules — the predicates that
// decide whether a single panel cell / token / select option should be marked
// invalid (typically painted red in the UI).
//
// All future rules of this kind MUST be added to this object so the
// validation logic stays in one place. Each rule is a pure function: it
// returns `true` when the value is INVALID. Components import the rules
// they need and apply them at render time.
//
// This is separate from `validation/validate.ts`, which produces a list of
// `ValidationIssue` records consumed by the Validation panel. Use
// `validate.ts` for cross-cutting model-level errors/warnings; use this
// module for inline, per-cell visual feedback.

import type { ModelVariable, TeiRow } from '@simulador/shared';
import type { DiagramAnalysis } from '../state/diagramAnalysis';

export const fieldRules = {
  /**
   * A variable defined in the panel but never referenced in the diagram —
   * paint its name input red so the user spots the orphan.
   */
  variableUnused(variable: ModelVariable, analysis: DiagramAnalysis): boolean {
    return analysis.unusedVars.has(variable.name);
  },

  /**
   * An identifier appearing inside a node label / formula that isn't
   * declared in the Variables panel. The mirror overlay paints these red.
   */
  diagramRefUndefined(identifier: string, analysis: DiagramAnalysis): boolean {
    return analysis.undefinedRefs.has(identifier);
  },

  /**
   * In the TEI table, the EFNC (Evento Futuro No Condicionado) column may
   * either be empty or carry the same value as the row's own *Evento*.
   * Anything else is invalid (no other event can be the unconditional
   * successor of a different event).
   */
  teiUnconditionalNextInvalid(row: TeiRow): boolean {
    const next = (row.unconditionalNext ?? '').trim();
    if (next === '') return false;
    return next !== row.event.trim();
  },

  /**
   * A routine block of type "Generación de dato" (callKind === 'function')
   * must have a label that contains exactly one identifier, and that
   * identifier must be declared as a `Dato` variable in the panel.
   * Multi-token / non-identifier labels and references to non-data variables
   * are invalid.
   */
  routineFunctionInvalid(
    nodeData: { callKind?: unknown; label?: unknown } | undefined,
    dataVarNames: Set<string>,
  ): boolean {
    if (!nodeData || nodeData.callKind !== 'function') return false;
    const label = typeof nodeData.label === 'string' ? nodeData.label.trim() : '';
    // Empty label is "still being typed" — don't flag.
    if (label === '') return false;
    const SINGLE_IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u;
    if (!SINGLE_IDENT.test(label)) return true;
    return !dataVarNames.has(label);
  },
};

export type FieldRules = typeof fieldRules;
