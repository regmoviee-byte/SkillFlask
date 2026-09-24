import { NavLink } from 'react-router';
import { copy } from '../copy';

const tabs = [
  {
    to: '/achievements',
    label: copy.tabs.achievements,
    icon: 'M8 4h8v4a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 12v4M8.5 20h7M10 16h4v4h-4z',
  },
  {
    to: '/skills',
    label: copy.tabs.skills,
    icon: 'M9.5 3h5M10 3v6.5L5.2 18a2 2 0 0 0 1.8 3h10a2 2 0 0 0 1.8-3L14 9.5V3M7.5 14h9',
  },
  {
    to: '/todo',
    label: copy.tabs.todo,
    icon: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  },
  {
    to: '/account',
    label: copy.tabs.account,
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  },
];

export function TabBar() {
  return (
    <nav className="tab-bar">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} className="tab" replace>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d={tab.icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
