import { NavLink } from 'react-router-dom';
import { Button, Group } from '@mantine/core';

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
 * `/intake` is the patient-facing form and carries no staff nav itself (2.0),
 * so its link opens it in a new tab, the way a patient would land on it,
 * rather than as one more console screen.
 */
export function AppNav() {
  return (
    <nav aria-label="Primary">
      <Group justify="space-between">
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
          <NavLink to="/intakes" style={LINK_STYLE}>
            Intakes
          </NavLink>
        </Group>
        <Button
          component="a"
          href="/intake"
          target="_blank"
          rel="noreferrer"
          size="xs"
          variant="light"
        >
          New patient intake
        </Button>
      </Group>
    </nav>
  );
}
