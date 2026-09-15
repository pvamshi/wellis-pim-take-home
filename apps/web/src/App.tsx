import { Navigate, Route, Routes } from 'react-router-dom';
import { DuplicatesPage } from './pages/DuplicatesPage';
import { HealthPage } from './pages/HealthPage';
import { RowsPage } from './pages/RowsPage';
import { RulesPage } from './pages/RulesPage';

/**
 * The whole route tree. Declarative routes only — no data router, no loaders
 * and no framework mode (tech-stack §4.1).
 *
 * The rules screen is what the console is for, so it owns `/` by redirect.
 * `/rows` sits beside it (1.6) — the same dataset seen through its rows
 * rather than through the rules. `/duplicates` sits beside both (1.7.4) — the
 * links the duplicate rules found. `/health` keeps the scaffold's page
 * reachable rather than deleting proof that the two halves of the repository
 * talk to each other.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/rules" element={<RulesPage />} />
      <Route path="/rows" element={<RowsPage />} />
      <Route path="/duplicates" element={<DuplicatesPage />} />
      <Route path="/health" element={<HealthPage />} />
      <Route path="/" element={<Navigate to="/rules" replace />} />
      <Route path="*" element={<Navigate to="/rules" replace />} />
    </Routes>
  );
}
