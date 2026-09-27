import { Fragment, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

export default function AppSelect({ label, value, options, placeholder, onChange, className = '', hideLabel = false, disabled = false }: {
  disabled?: boolean; label: string; value: string; options: { value: string; label: string; group?: string }[]; placeholder?: string; className?: string; hideLabel?: boolean; onChange: (value: string) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const [active, setActive] = useState(0);
  const selected = options.findIndex((option) => option.value === value);
  function open() {
    if (disabled || !options.length) return;
    const rect = trigger.current!.getBoundingClientRect();
    const height = Math.min(options.length * 40 + new Set(options.map(option => option.group).filter(Boolean)).size * 28 + 10, 240);
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const flip = below < height && above > below;
    setPosition({ left: rect.left, width: rect.width, maxHeight: Math.max(40, Math.min(240, flip ? above : below)), ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
    setActive(Math.max(0, selected));
  }
  function choose(index: number) {
    if (disabled || !options[index]) return;
    onChange(options[index].value); setPosition(null); trigger.current?.focus();
  }
  useEffect(() => {
    if (!position) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && (menu.current?.contains(event.target) || trigger.current?.contains(event.target))) return;
      setPosition(null);
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [position]);
  useEffect(() => { if (disabled) setPosition(null); }, [disabled]);
  useEffect(() => { menu.current?.querySelectorAll('[role=option]')[active]?.scrollIntoView({ block: 'nearest' }); }, [active, position]);
  return <div className={`app-select ${className}`} onClick={(event) => event.stopPropagation()}>
    {!hideLabel && <label id={`${id}-label`} htmlFor={id}>{label}</label>}
    <button disabled={disabled} ref={trigger} id={id} type="button" role="combobox" aria-label={hideLabel ? label : undefined} aria-labelledby={hideLabel ? undefined : `${id}-label`} aria-expanded={!!position} aria-haspopup="listbox" aria-controls={position ? `${id}-options` : undefined} aria-activedescendant={position ? `${id}-${active}` : undefined}
      onClick={() => position ? setPosition(null) : open()}
      onBlur={() => setPosition(null)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && position) { event.preventDefault(); event.stopPropagation(); setPosition(null); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!position) open(); else setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
        } else if ((event.key === 'Enter' || event.key === ' ') && position) { event.preventDefault(); choose(active); }
        else if (position && (event.key === 'Home' || event.key === 'End')) { event.preventDefault(); setActive(event.key === 'Home' ? 0 : options.length - 1); }
      }}>
      <span>{options[selected]?.label ?? placeholder}</span><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {position && createPortal(<div ref={menu} id={`${id}-options`} className="app-select-options" style={position} role="listbox" aria-label={hideLabel ? label : undefined} aria-labelledby={hideLabel ? undefined : `${id}-label`} onMouseDown={(event) => event.preventDefault()}>
      {options.map((option, index) => <Fragment key={option.value}>
        {option.group && option.group !== options[index - 1]?.group && <div className="app-select-group" role="presentation">{option.group}</div>}
        <div id={`${id}-${index}`} role="option" aria-selected={value === option.value} data-value={option.value} className={active === index ? 'active' : ''} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>
        <span>{option.label}</span><span aria-hidden="true">{value === option.value ? '✓' : ''}</span>
      </div></Fragment>)}
    </div>, document.body)}
  </div>;
}
