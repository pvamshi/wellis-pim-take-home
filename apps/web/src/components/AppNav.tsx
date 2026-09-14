import { NavLink } from 'react-router-dom';
import { Group } from '@mantine/core';

/**
 * The two-link nav shown atop both screens.
 *
 * Nothing in the requirements asks for chrome, but without it `/rows` is
 * reachable only by typing the URL — the app otherwise has none (`RulesPage`
 * itself has no navigation of its own). `NavLink` distinguishes the current
 * route without this component holding any router state of its own.
 */
export function AppNav() {
  return (
    <nav aria-label="Primary">
      <Group gap="md">
        <NavLink
          to="/rules"
          style={({ isActive }) => ({
            fontWeight: isActive ? 700 : 400,
            color: isActive ? 'var(--mantine-color-blue-6)' : 'var(--mantine-color-dimmed)',
            textDecoration: 'none',
          })}
        >
          Rules
        </NavLink>
        <NavLink
          to="/rows"
          style={({ isActive }) => ({
            fontWeight: isActive ? 700 : 400,
            color: isActive ? 'var(--mantine-color-blue-6)' : 'var(--mantine-color-dimmed)',
            textDecoration: 'none',
          })}
        >
          Rows
        </NavLink>
      </Group>
    </nav>
  );
}
