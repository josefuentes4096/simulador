import type { SimulationModel } from '@simulador/shared';
import { i18n } from '../locales';

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  severity: Severity;
  message: string;
}

const STATE_ACCESS_RE = /\bstate\.([A-Za-z_$][\w$]*)/g;
const SCHEDULE_CALL_RE = /\bschedule\s*\(\s*[^,)]+,\s*['"]([^'"]+)['"]/g;

const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.t(key, params) as unknown as string;

export function validate(model: SimulationModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const variableNames = new Set<string>();
  const duplicateVars = new Set<string>();
  for (const v of model.behavior.variables) {
    if (!v.name.trim()) {
      issues.push({ severity: 'error', message: t('validation.emptyVarName') });
      continue;
    }
    if (variableNames.has(v.name)) duplicateVars.add(v.name);
    variableNames.add(v.name);
  }
  for (const name of duplicateVars) {
    issues.push({ severity: 'error', message: t('validation.duplicateVar', { name }) });
  }

  const eventNames = new Set<string>();
  const duplicateEvents = new Set<string>();
  for (const e of model.behavior.events) {
    if (!e.name.trim()) {
      issues.push({ severity: 'error', message: t('validation.emptyEventName') });
      continue;
    }
    if (eventNames.has(e.name)) duplicateEvents.add(e.name);
    eventNames.add(e.name);
  }
  for (const name of duplicateEvents) {
    issues.push({ severity: 'error', message: t('validation.duplicateEvent', { name }) });
  }

  for (const e of model.behavior.events) {
    if (!e.handler.trim()) {
      issues.push({
        severity: 'warning',
        message: t('validation.emptyHandler', { name: e.name }),
      });
      continue;
    }

    const seenStateRefs = new Set<string>();
    let m: RegExpExecArray | null;

    STATE_ACCESS_RE.lastIndex = 0;
    while ((m = STATE_ACCESS_RE.exec(e.handler)) !== null) {
      const ref = m[1]!;
      if (seenStateRefs.has(ref)) continue;
      seenStateRefs.add(ref);
      if (!variableNames.has(ref)) {
        issues.push({
          severity: 'warning',
          message: t('validation.unknownStateRef', { event: e.name, ref }),
        });
      }
    }

    const seenScheduleTargets = new Set<string>();
    SCHEDULE_CALL_RE.lastIndex = 0;
    while ((m = SCHEDULE_CALL_RE.exec(e.handler)) !== null) {
      const target = m[1]!;
      if (seenScheduleTargets.has(target)) continue;
      seenScheduleTargets.add(target);
      if (!eventNames.has(target)) {
        issues.push({
          severity: 'error',
          message: t('validation.unknownScheduleTarget', { event: e.name, target }),
        });
      }
    }
  }

  for (const ie of model.behavior.initialEvents ?? []) {
    if (!eventNames.has(ie.name)) {
      issues.push({
        severity: 'error',
        message: t('validation.initialUnknownEvent', { name: ie.name }),
      });
    }
    if (ie.time < 0) {
      issues.push({
        severity: 'error',
        message: t('validation.initialNegativeTime', { name: ie.name, time: ie.time }),
      });
    }
  }

  if ((model.behavior.initialEvents?.length ?? 0) === 0 && model.behavior.events.length > 0) {
    issues.push({
      severity: 'warning',
      message: t('validation.noInitialEvents'),
    });
  }

  return issues;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
