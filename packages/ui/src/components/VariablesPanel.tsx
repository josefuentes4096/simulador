import type { Dispatch, SetStateAction } from 'react';
import { Fragment, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelVariable, VariableKind } from '@simulador/shared';
import { DiagramAnalysisContext } from '../state/diagramAnalysisContext';
import { fieldRules } from '../validation/fieldRules';

interface Props {
  variables: ModelVariable[];
  setVariables: Dispatch<SetStateAction<ModelVariable[]>>;
}

type ScalarSection = 'data' | 'control' | 'state' | 'result';
type ArraySection = 'data' | 'state' | 'result';

// Visible subsection order. TEF comes last and is conditional.
const SCALAR_SECTIONS: ScalarSection[] = ['data', 'control', 'state', 'result'];

// Dropdown options per section. Control only allows its own kind; the other
// three also allow `array` (an array variable still belongs to a specific
// subsection — see `section` on ModelVariable).
const KIND_OPTIONS_BY_SECTION: Record<ScalarSection, VariableKind[]> = {
  data: ['data', 'array'],
  control: ['control'],
  state: ['state', 'array'],
  result: ['result', 'array'],
};

const TEF_KIND_OPTIONS: VariableKind[] = ['event-table', 'event-table-array'];

const DEFAULT_KIND_BY_SECTION: Record<ScalarSection, VariableKind> = {
  data: 'data',
  control: 'control',
  state: 'state',
  result: 'result',
};

const SECTION_LABEL_KEY: Record<ScalarSection, string> = {
  data: 'variables.sectionData',
  control: 'variables.sectionControl',
  state: 'variables.sectionState',
  result: 'variables.sectionResult',
};

function sectionOf(v: ModelVariable): ScalarSection | 'tef' {
  switch (v.kind) {
    case 'data':
      return 'data';
    case 'control':
      return 'control';
    case 'state':
      return 'state';
    case 'result':
      return 'result';
    case 'array':
      // Legacy array variables (no section field) default to Estado.
      return v.section ?? 'state';
    case 'event-table':
    case 'event-table-array':
      return 'tef';
  }
}

// When the user picks a kind that doesn't fit the row's current section
// (e.g. picking `array` from a Control row, or switching from `state` to
// `data`), this resolves where the variable should land. Section field is
// only persisted for kind === 'array'; for the other scalar kinds the
// section is fully derivable from the kind.
function resolveSectionAfterKindChange(
  newKind: VariableKind,
  prev: ScalarSection | 'tef',
): ArraySection | undefined {
  if (newKind !== 'array') return undefined;
  // Arrays are only valid in data / state / result. Coming from Control or
  // TEF, fall back to Estado as a sensible default.
  if (prev === 'data' || prev === 'state' || prev === 'result') return prev;
  return 'state';
}

function parseInitialValue(raw: string, kind: VariableKind): ModelVariable['initialValue'] {
  if (raw === '') return undefined;
  if (kind === 'event-table-array') {
    const n = Number(raw.trim());
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  }
  if (kind === 'array') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'number')) {
          return parsed;
        }
      } catch {
        // Fall through — treat as a malformed array literal, drop the value.
      }
      return undefined;
    }
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  if (!Number.isNaN(n) && raw.trim() !== '') return n;
  return raw;
}

function formatInitialValue(v: ModelVariable['initialValue']): string {
  if (v === undefined) return '';
  if (Array.isArray(v)) return JSON.stringify(v);
  return String(v);
}

export function VariablesPanel({ variables, setVariables }: Props) {
  const { t } = useTranslation();
  const analysis = useContext(DiagramAnalysisContext);

  const onAddToSection = useCallback(
    (section: ScalarSection) => {
      setVariables((vs) => {
        // Insert just after the last variable already in this section so
        // canonical JSON output keeps subsections grouped.
        let lastIdx = -1;
        for (let i = 0; i < vs.length; i++) {
          if (sectionOf(vs[i]!) === section) lastIdx = i;
        }
        const baseName = `var${vs.length + 1}`;
        const newVar: ModelVariable =
          section === 'data'
            ? { name: baseName, kind: 'data' }
            : { name: baseName, kind: DEFAULT_KIND_BY_SECTION[section], initialValue: 0 };
        if (lastIdx === -1) return [...vs, newVar];
        return [...vs.slice(0, lastIdx + 1), newVar, ...vs.slice(lastIdx + 1)];
      });
    },
    [setVariables],
  );

  const onUpdate = useCallback(
    (index: number, patch: Partial<ModelVariable>) => {
      setVariables((vs) =>
        vs.map((v, i) => {
          if (i !== index) return v;
          let next: ModelVariable = { ...v, ...patch };
          if (patch.initialValue === undefined && 'initialValue' in patch) {
            const { initialValue: _drop, ...rest } = next;
            next = rest;
          }
          if (
            'description' in patch &&
            (patch.description === undefined || patch.description === '')
          ) {
            const { description: _drop, ...rest } = next;
            next = rest;
          }
          // Variables of kind 'data' are generated at runtime — drop any
          // initialValue when switching to that kind so the saved JSON stays
          // clean and the input doesn't display a stale value.
          if (next.kind === 'data' && next.initialValue !== undefined) {
            const { initialValue: _drop, ...rest } = next;
            next = rest;
          }
          // Maintain the `section` field. It is only meaningful for kind
          // 'array'; for the other kinds we strip it so the JSON stays
          // tidy.
          if ('kind' in patch) {
            const resolved = resolveSectionAfterKindChange(next.kind, sectionOf(v));
            if (next.kind === 'array') {
              next.section = resolved;
            } else if (next.section !== undefined) {
              const { section: _drop, ...rest } = next;
              next = rest;
            }
          }
          return next;
        }),
      );
    },
    [setVariables],
  );

  const onDelete = useCallback(
    (index: number) => {
      setVariables((vs) => vs.filter((_, i) => i !== index));
    },
    [setVariables],
  );

  // Pre-bucket variables by section while preserving each variable's
  // original index in the array (callbacks below use that index to patch
  // the right entry).
  type IndexedVar = { v: ModelVariable; index: number };
  const buckets: Record<ScalarSection | 'tef', IndexedVar[]> = {
    data: [],
    control: [],
    state: [],
    result: [],
    tef: [],
  };
  variables.forEach((v, index) => {
    buckets[sectionOf(v)].push({ v, index });
  });

  const renderRow = ({ v, index: i }: IndexedVar, kindOptions: VariableKind[]) => (
    <div className="var-row" key={i}>
      <input
        className={`var-row__name ${
          fieldRules.variableUnused(v, analysis) ? 'var-row__name--unused' : ''
        }`}
        value={v.name}
        onChange={(e) => onUpdate(i, { name: e.target.value })}
        placeholder={t('variables.namePlaceholder')}
        spellCheck={false}
        title={fieldRules.variableUnused(v, analysis) ? t('variables.unusedHint') : undefined}
      />
      <select
        className={`var-row__kind badge--${v.kind}`}
        value={v.kind}
        onChange={(e) => onUpdate(i, { kind: e.target.value as VariableKind })}
      >
        {kindOptions.map((k) => (
          <option key={k} value={k}>
            {t(`variables.kindLabel.${k}`)}
          </option>
        ))}
      </select>
      <input
        className={`var-row__init ${
          fieldRules.variableInitialDiverges(v, analysis.ciValues)
            ? 'var-row__init--diverges'
            : ''
        }`}
        value={v.kind === 'data' ? '' : formatInitialValue(v.initialValue)}
        onChange={(e) =>
          onUpdate(i, { initialValue: parseInitialValue(e.target.value, v.kind) })
        }
        placeholder={
          v.kind === 'data'
            ? '—'
            : v.kind === 'array'
              ? t('variables.arrayInitPlaceholder')
              : t('variables.initPlaceholder')
        }
        spellCheck={false}
        disabled={v.kind === 'data'}
        title={
          fieldRules.variableInitialDiverges(v, analysis.ciValues)
            ? t('variables.initialDivergesHint')
            : v.kind === 'data'
              ? t('variables.dataNoInitHint')
              : v.kind === 'array'
                ? t('variables.arrayInitHint')
                : undefined
        }
      />
      <input
        className="var-row__desc"
        value={v.description ?? ''}
        onChange={(e) => onUpdate(i, { description: e.target.value })}
        placeholder={t('variables.descriptionPlaceholder')}
      />
      <button
        className="var-row__delete"
        onClick={() => onDelete(i)}
        aria-label={t('variables.deleteAria')}
        title={t('variables.deleteTitle')}
      >
        ×
      </button>
    </div>
  );

  return (
    <section className="panel">
      <header className="panel__header">
        <h3>{t('variables.header')}</h3>
      </header>
      <div className="var-grid">
        <div className="var-row var-row--header">
          <span>{t('variables.colName')}</span>
          <span>{t('variables.colKind')}</span>
          <span>{t('variables.colInit')}</span>
          <span>{t('variables.colDescription')}</span>
          <span aria-hidden="true" />
        </div>
        {SCALAR_SECTIONS.map((section, idx) => (
          <Fragment key={section}>
            <div
              className={`var-grid__section-header${
                idx === 0 ? ' var-grid__section-header--first' : ''
              }`}
            >
              <span>{t(SECTION_LABEL_KEY[section])}</span>
              <button
                className="panel__add"
                onClick={() => onAddToSection(section)}
                aria-label={t('variables.addAria')}
              >
                +
              </button>
            </div>
            {buckets[section].map((iv) => renderRow(iv, KIND_OPTIONS_BY_SECTION[section]))}
          </Fragment>
        ))}
        {buckets.tef.length > 0 && (
          <>
            <div className="var-grid__section-header">
              <span>{t('variables.tefSectionHeader')}</span>
            </div>
            {buckets.tef.map((iv) => renderRow(iv, TEF_KIND_OPTIONS))}
          </>
        )}
      </div>
    </section>
  );
}
