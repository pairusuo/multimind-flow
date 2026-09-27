import { useTranslation } from 'react-i18next';
import { LAYOUT_TEMPLATES, LayoutTemplate } from '../../shared/presetTemplates';
import { LayoutIcon, WorkspaceIcon } from './WorkspaceIcon';

interface TemplateChooserProps {
  onApplyTemplate: (template: LayoutTemplate) => void;
}

export default function TemplateChooser({ onApplyTemplate }: TemplateChooserProps) {
  const { t } = useTranslation();

  return (
    <div className="modal-backdrop">
      <section className="template-panel" aria-label={t('templateChooser.aria.panel')}>
        <header>
          <h1>{t('templateChooser.title')}</h1>
        </header>
        <div className="template-grid">
          {LAYOUT_TEMPLATES.map((template) => (
            <button key={template.id} type="button" className="template-card" onClick={() => onApplyTemplate(template)}>
              <LayoutIcon mode={template.layout} />
              <span>{t(`templateChooser.templates.${template.id}`, { defaultValue: template.name })}</span>
              <small>{t('templateChooser.cellCount', { count: template.siteIds.length })}</small>
            </button>
          ))}
          <button
            type="button"
            className="template-card"
            onClick={() =>
              onApplyTemplate({
                id: 'custom',
                name: t('templateChooser.custom.name'),
                layout: 'triple',
                siteIds: [],
              })
            }
          >
            <WorkspaceIcon name="settings" />
            <span>{t('templateChooser.custom.name')}</span>
            <small>{t('templateChooser.custom.description')}</small>
          </button>
        </div>
      </section>
    </div>
  );
}
