import { useTranslation } from 'react-i18next';
import type { ValidationIssue } from '../validation/validate';

interface Props {
  issues: ValidationIssue[];
}

export function ValidationPanel({ issues }: Props) {
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  return (
    <section className={`panel validation ${errors > 0 ? 'validation--error' : 'validation--warning'}`}>
      <header className="panel__header">
        <h3>
          {errors > 0 ? '✕ ' : '⚠ '}
          {t('validation.header')}
          <span className="validation__counts">
            {errors > 0 && t('validation.errorCount', { count: errors })}
            {errors > 0 && warnings > 0 && ', '}
            {warnings > 0 && t('validation.warningCount', { count: warnings })}
          </span>
        </h3>
      </header>
      <ul className="validation__list">
        {issues.map((issue, i) => (
          <li
            key={i}
            className={`validation__item validation__item--${issue.severity}`}
          >
            <span className="validation__icon" aria-hidden="true">
              {issue.severity === 'error' ? '✕' : '⚠'}
            </span>
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
