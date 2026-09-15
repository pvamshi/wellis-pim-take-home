import { NavLink } from 'react-router-dom';
import { Group } from '@mantine/core';

const LINK_STYLE = ({ isActive }: { isActive: boolean }) => ({
  fontWeight: isActive ? 700 : 400,
  color: isActive ? 'var(--mantine-color-blue-6)' : 'var(--mantine-color-dimmed)',
  textDecoration: 'none',
});

/**
 * The staff nav shown atop every staff screen.
 *
 * Nothing in the requirements asks for chrome, but without it `/rows`,
 * `/duplicates` and `/review` are reachable only by typing the URL — the app
 * otherwise has none (`RulesPage` itself has no navigation of its own).
 * `NavLink` distinguishes the current route without this component holding
 * any router state of its own.
 *
 * `/intake` is deliberately not a link here (2.0's route table: "no staff
 * nav") — it is the one patient-facing corner of this app, reached from
 * outside it, not clicked to from the console.
 */
export function AppNav() {
  return (
    <nav aria-label="Primary">
      <Group gap="md">
        <NavLink to="/rules" style={LINK_STYLE}>
          Rules
        </NavLink>
        <NavLink to="/rows" style={LINK_STYLE}>
          Rows
        </NavLink>
        <NavLink to="/duplicates" style={LINK_STYLE}>
          Duplicates
        </NavLink>
        <NavLink to="/review" style={LINK_STYLE}>
          Review
        </NavLink>
      </Group>
    </nav>
  );
}
